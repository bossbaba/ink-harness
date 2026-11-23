#!/usr/bin/env bash
# 提交 + 变更记录 + 推送 + 可选打 tag 的一键脚本。
#
# 为什么这样设计：
# 1. 项目约定每次涉及代码的提交都要写 docs/changelogs/YYYY-MM-DD.md，且 changelog 要带提交 hash。
#    hash 只有 commit 之后才知道，所以先提交代码，再用真实 hash 生成当天记录并单独提交，
#    两个 commit 在同一次 git push 中推上去；纯文档提交不再追加记录，避免递归。
# 2. 发版由 CI 的 tag 推送触发（.github/workflows/ci.yml），所以打 tag 放在分支推送之后，
#    保证 tag 指向的 commit 已经存在于远端。
#
# 用法：
#   bash scripts/push.sh                        # 交互询问类型、简述、是否打 tag
#   bash scripts/push.sh --tag v0.2.0           # 不打 tag 确认，直接按给定版本打 tag
#   bash scripts/push.sh --no-tag               # 明确不打 tag
#   bash scripts/push.sh --dry-run --tag v0.2.0 # 只打印将做什么，不修改任何东西

set -euo pipefail

DRY_RUN=0
TAG_MODE="ask"
TAG_VALUE=""

# 参数解析：--dry-run / --tag 版本 / --no-tag / -h|--help。
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --tag)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        echo "错误：--tag 后面需要跟版本号，如 v0.2.0" >&2
        exit 1
      fi
      TAG_MODE="set"
      TAG_VALUE="$2"
      shift 2
      ;;
    --no-tag)
      TAG_MODE="no"
      shift
      ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数：${1}（用 --help 查看用法）" >&2
      exit 1
      ;;
  esac
done

die() {
  echo "错误：$*" >&2
  exit 1
}

# dry-run 下只打印命令，真实模式才执行。
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] git'
    printf ' %q' "$@"
    printf '\n'
  else
    git "$@"
  fi
}

# 前置检查：必须在 git 仓库的分支上，且有已配置的 upstream，避免误推到错误的远端。
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "当前目录不是 git 仓库"
cd "$(git rev-parse --show-toplevel)"

BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || true)
[ -n "$BRANCH" ] || die "当前处于 detached HEAD，请先切回分支再运行"
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
FIRST_PUSH=0
if [ -n "$UPSTREAM" ]; then
  REMOTE=${UPSTREAM%%/*}
else
  # 首次推送时没有 upstream 是常态：优先用 origin，多远端时拒绝猜测，避免推错地方。
  if git remote get-url origin >/dev/null 2>&1; then
    REMOTE="origin"
  else
    REMOTE=$(git remote | head -n 1 || true)
    [ -n "$REMOTE" ] || die "未配置任何远端，请先执行 git remote add origin <地址>"
    [ "$(git remote | wc -l | tr -d ' ')" = "1" ] \
      || die "存在多个远端且分支 $BRANCH 没有 upstream，请先手动执行 git push -u <远端> $BRANCH"
  fi
  UPSTREAM="$REMOTE/$BRANCH"
  FIRST_PUSH=1
fi
git remote get-url "$REMOTE" >/dev/null 2>&1 || die "找不到远端 $REMOTE"

echo "分支：$BRANCH -> $UPSTREAM"

# 只排除 changelog 目录：其他文件（含文档）变更都视为需要写变更记录。
CODE_CHANGES=$(git status --porcelain -- . ':(exclude)docs/changelogs')
ALL_CHANGES=$(git status --porcelain)

COMMIT_TYPE=""
COMMIT_SUMMARY=""
CHANGELOG_DETAIL=""
MADE_CODE_COMMIT=0

if [ -n "$ALL_CHANGES" ]; then
  if [ -z "$CODE_CHANGES" ]; then
    echo "当前只有 docs/changelogs 下的文档改动，按约定不再追加变更记录。"
    DEFAULT_TYPE="docs"
  else
    echo "检测到待提交改动："
    printf '%s\n' "$CODE_CHANGES"
    DEFAULT_TYPE="feat"
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    COMMIT_TYPE="$DEFAULT_TYPE"
    COMMIT_SUMMARY="（dry-run 示例：本次改动说明）"
    CHANGELOG_DETAIL="- （dry-run 示例：改动要点）"
    echo "[dry-run] 将交互询问提交类型、简述与改动要点，示例使用：${COMMIT_TYPE}：${COMMIT_SUMMARY}"
  else
    read -r -p "提交类型（feat/fix/docs/refactor/chore/perf/test，默认 ${DEFAULT_TYPE}）：" COMMIT_TYPE
    COMMIT_TYPE=${COMMIT_TYPE:-$DEFAULT_TYPE}
    case "$COMMIT_TYPE" in
      feat|fix|docs|refactor|chore|perf|test) ;;
      *) die "不支持的提交类型：$COMMIT_TYPE" ;;
    esac
    read -r -p "一句话简述：" COMMIT_SUMMARY
    [ -n "$COMMIT_SUMMARY" ] || die "简述不能为空"

    # 改动要点逐行录入，空行结束；每行自动加 "- "，省得再手改 changelog。
    echo "改动要点（每行一条，空行结束；直接回车则留占位符）："
    while IFS= read -r detail_line; do
      [ -z "$detail_line" ] && break
      if [ -n "$CHANGELOG_DETAIL" ]; then
        CHANGELOG_DETAIL="${CHANGELOG_DETAIL}"$'\n'"- ${detail_line}"
      else
        CHANGELOG_DETAIL="- ${detail_line}"
      fi
    done
    [ -n "$CHANGELOG_DETAIL" ] || CHANGELOG_DETAIL="- （待补充：本次改动要点与验证结果）"
  fi

  # 先提交代码，hash 才有值；changelog 里要写这个真实 hash。
  run add -A
  run commit -m "${COMMIT_TYPE}：${COMMIT_SUMMARY}"
  MADE_CODE_COMMIT=1
else
  echo "工作区干净，没有需要提交的改动。"
fi

# 在指定标题后插入一段内容，并吃掉原标题后的空行，避免出现多余空行。
# 用 bash 逐行处理而不是 awk：macOS 自带 awk 对含中文的 -v 变量比较不可靠。
insert_after_heading() {
  local file="$1" heading="$2" content_file="$3" tmp line inserted=0 skip_blank=0
  tmp=$(mktemp)
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$inserted" -eq 0 ] && [ "$line" = "$heading" ]; then
      printf '%s\n' "$line"
      printf '\n'
      cat "$content_file"
      inserted=1
      skip_blank=1
      continue
    fi
    if [ "$inserted" -eq 1 ] && [ "$skip_blank" -eq 1 ] && [ -z "$line" ]; then
      skip_blank=0
      continue
    fi
    printf '%s\n' "$line"
  done < "$file" > "$tmp"
  [ "$inserted" -eq 1 ] || { rm -f "$tmp"; die "未找到标题：${heading}"; }
  mv "$tmp" "$file"
}

# 生成/更新当天 changelog：新文件直接写完整模板，已有文件按约定插到「当日提交」和「更新内容」顶部。
write_changelog() {
  local hash="$1" type="$2" summary="$3" detail="$4"
  local date_stamp file entry block entry_file block_file

  date_stamp=$(date "+%Y-%m-%d")
  file="docs/changelogs/${date_stamp}.md"
  entry="- \`${hash}\` ${type}：${summary}"
  # 末尾留两个换行，插入已有文件时才能和下一节标题之间保持一个空行。
  block="### ${type}：${summary}"$'\n\n'"${detail}"$'\n\n'

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] 将写入/更新 ${file}："
    printf '%s\n' "$entry"
    printf '%s\n' "$block"
    return
  fi

  mkdir -p docs/changelogs
  if [ ! -f "$file" ]; then
    {
      echo "# ${date_stamp} 变更记录"
      echo
      echo "## 当日提交"
      echo
      echo "$entry"
      echo
      echo "## 更新内容"
      echo
      printf '%s' "$block"
      echo "---"
      echo
      echo "归档约定：本目录按天一个文件记录变更，与代码一起提交、一起推送；仅维护文档本身、不再产生代码变更的记录性提交，不再追加条目，避免递归记录。"
    } > "$file"
  else
    grep -q '^## 当日提交$' "$file" || die "$file 缺少「## 当日提交」标题，拒绝盲目追加"
    grep -q '^## 更新内容$' "$file" || die "$file 缺少「## 更新内容」标题，拒绝盲目追加"

    entry_file=$(mktemp)
    block_file=$(mktemp)
    printf '%s\n' "$entry" > "$entry_file"
    printf '%s' "$block" > "$block_file"
    insert_after_heading "$file" "## 当日提交" "$entry_file"
    insert_after_heading "$file" "## 更新内容" "$block_file"
    rm -f "$entry_file" "$block_file"
  fi

  echo "已更新 $file"
}

if [ "$MADE_CODE_COMMIT" -eq 1 ] && [ -n "$CODE_CHANGES" ]; then
  SHORT_HASH=$(git rev-parse --short=7 HEAD)
  write_changelog "$SHORT_HASH" "$COMMIT_TYPE" "$COMMIT_SUMMARY" "$CHANGELOG_DETAIL"
  run add -- "docs/changelogs/$(date '+%Y-%m-%d').md"
  run commit -m "docs：更新 $(date '+%Y-%m-%d') 变更记录"
fi

# 本地门禁是可选的：CI 会全量跑，但推送前跑一遍能省一次红 CI。
if [ "$DRY_RUN" -eq 0 ]; then
  read -r -p "推送前跑本地检查（pnpm check / check:conventions / test）？[y/N]:" CHECK_ANSWER
  case "$CHECK_ANSWER" in
    y|Y|yes|YES)
      pnpm check && pnpm check:conventions && pnpm test || die "本地检查未通过，已停止推送"
      ;;
  esac
else
  echo "[dry-run] 将交互询问是否跑本地检查"
fi

# 先推分支，tag 必须指向已存在的远端提交，否则 CI 的 Release job 拿不到构建产物。
if [ "$FIRST_PUSH" -eq 1 ]; then
  run push -u "$REMOTE" "$BRANCH"
else
  run push "$REMOTE" "$BRANCH"
fi

# 是否发版：tag 推送会触发 CI 的三平台打包和公开 Release。
if [ "$TAG_MODE" = "ask" ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] 将交互询问是否打 tag 发布版本"
    TAG_MODE="no"
  else
    read -r -p "是否打 tag 发布版本？[y/N]:" TAG_ANSWER
    case "$TAG_ANSWER" in
      y|Y|yes|YES) TAG_MODE="set" ;;
      *) TAG_MODE="no" ;;
    esac
  fi
fi

if [ "$TAG_MODE" = "set" ]; then
  if [ "$DRY_RUN" -eq 0 ]; then
    if [ -z "$TAG_VALUE" ]; then
      LATEST_TAG=$(git tag --list 'v*' --sort=-v:refname | head -n 1 || true)
      [ -n "$LATEST_TAG" ] && echo "当前最新 tag：$LATEST_TAG"
      read -r -p "输入版本号（形如 v0.2.0）：" TAG_VALUE
    fi
    printf '%s' "$TAG_VALUE" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$' \
      || die "版本号格式不对，应为 v主.次.补（可带 -rc.1 等后缀）"
    git rev-parse -q --verify "refs/tags/$TAG_VALUE" >/dev/null && die "本地已存在 tag $TAG_VALUE"
    git ls-remote --exit-code "$REMOTE" "refs/tags/$TAG_VALUE" >/dev/null 2>&1 && die "远端已存在 tag $TAG_VALUE"
    git tag -a "$TAG_VALUE" -m "release $TAG_VALUE"
    git push "$REMOTE" "$TAG_VALUE"
  else
    TAG_VALUE=${TAG_VALUE:-vX.Y.Z}
    printf '[dry-run] git tag -a %q -m %q\n' "$TAG_VALUE" "release $TAG_VALUE"
    printf '[dry-run] git push %q %q\n' "$REMOTE" "$TAG_VALUE"
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] tag ${TAG_VALUE} 将被推送，CI 会开始三平台打包并发布 Release。"
  else
    echo "tag ${TAG_VALUE} 已推送，CI 将开始三平台打包并发布 Release。"
  fi
else
  echo "未打 tag，本次只推送代码。"
fi
