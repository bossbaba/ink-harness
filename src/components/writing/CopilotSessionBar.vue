<script setup lang="ts">
import { NButton, NInput, NModal, NPopconfirm, NTab, NTabs } from "naive-ui";
import { computed, ref } from "vue";
import type { AgentSession, CopilotSessionBarState } from "@/types";
import { MODAL_WIDTH, modalStyle } from "@/utils/modal";

/**
 * Copilot 面板顶部的会话条：naive-ui 的卡片式 Tabs + 新建。
 *
 * 为什么用 Tabs 而不是下拉：会话是「并列的几条线」，Tabs 能一眼看到有哪些、
 * 当前在哪条，关闭就地完成；下拉要先展开再选，在 320px 宽的面板里反而更费劲。
 *
 * 交互约定：
 * - 单击标签切换；双击标签文字重命名（窄面板放不下额外的铅笔按钮）。
 * - 标签右侧 × 关闭，配 NPopconfirm 二次确认——会话删除不可恢复。
 * - 末尾 +（NTabs 的 addable）新建；还没落库时显示「新对话」占位标签。
 */
const props = defineProps<{
  state: CopilotSessionBarState;
}>();

/** 未落库的新对话占位标签名；用双下划线前缀避免与库里生成的 id 撞名。 */
const NEW_TAB = "__new__";

const currentSessionId = computed(() => props.state.currentId);
/** 受控值：没有会话时指向占位标签，Tabs 才不会出现「一个都没选中」的状态。 */
const activeTab = computed(() => props.state.currentId || NEW_TAB);

const renaming = ref(false);
const renameDraft = ref("");
/** 正在重命名的会话；null 表示没有打开弹窗。 */
const renameTarget = ref<AgentSession | null>(null);

/** 标签文字：空标题给占位，避免出现一个只剩关闭按钮的空标签。 */
function tabTitle(session: AgentSession): string {
  return session.title || "未命名对话";
}

function switchTo(id: string): void {
  if (!id || id === NEW_TAB || id === currentSessionId.value) return;
  void props.state.onAction({ type: "switch", id });
}

/** 双击标签进入重命名；单击已经用于切换，所以只认 dblclick。 */
function openRename(session: AgentSession): void {
  renameTarget.value = session;
  renameDraft.value = session.title;
  renaming.value = true;
}

function confirmRename(): void {
  const target = renameTarget.value;
  if (!target) {
    renaming.value = false;
    return;
  }
  void props.state.onAction({
    type: "rename",
    id: target.id,
    title: renameDraft.value.trim() || "未命名对话",
  });
  renaming.value = false;
}

function newSession(): void {
  void props.state.onAction({ type: "new" });
}

/** 关闭标签：交给上层删库并同步列表；这里只转发，不自行移除节点。 */
function closeSession(id: string): void {
  void props.state.onAction({ type: "delete", id });
}
</script>

<template>
  <section class="tabs">
    <!--
      paneWrapperStyle 直接隐藏内容区：这里只用 Tabs 的标签栏，消息仍在下方 chat__list 里。
      closable 不开，是因为内置关闭图标无法挂 NPopconfirm；关闭按钮放在标签内容里。
    -->
    <NTabs
      class="tabs__nav"
      type="card"
      size="small"
      :value="activeTab"
      :tabs-padding="0"
      addable
      :pane-wrapper-style="{ display: 'none' }"
      @update:value="(value: string | number) => switchTo(String(value))"
      @add="newSession"
    >
      <NTab v-if="!currentSessionId" :name="NEW_TAB" :closable="false">
        <span class="tabs__label">新对话</span>
      </NTab>

      <NTab
        v-for="session in state.sessions"
        :key="session.id"
        :name="session.id"
        :closable="false"
      >
        <span
          class="tabs__label"
          :title="`${tabTitle(session)}（双击重命名）`"
          @dblclick="openRename(session)"
        >
          {{ tabTitle(session) }}
        </span>
        <NPopconfirm
          positive-text="关闭"
          negative-text="取消"
          @positive-click="closeSession(session.id)"
        >
          <template #trigger>
            <NButton class="tabs__close" size="tiny" quaternary title="关闭这条会话" @click.stop
              >×</NButton
            >
          </template>
          关闭后这条会话的聊天记录与轨迹都会清掉，无法恢复。
        </NPopconfirm>
      </NTab>
    </NTabs>

    <p v-if="state.error" class="tabs__error">{{ state.error }}</p>

    <!-- 单输入框用最窄档：弹窗宽度必须显式给，否则会撑满窗口（见 utils/modal.ts）。 -->
    <NModal
      v-model:show="renaming"
      preset="card"
      title="重命名会话"
      :style="modalStyle(MODAL_WIDTH.sm)"
      :bordered="false"
    >
      <NInput
        v-model:value="renameDraft"
        placeholder="例如：第三章审稿"
        @keyup.enter="confirmRename"
      />
      <template #footer>
        <div class="tabs__footer">
          <NButton size="small" @click="renaming = false">取消</NButton>
          <NButton size="small" type="primary" @click="confirmRename">保存</NButton>
        </div>
      </template>
    </NModal>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.tabs {
  // 标签栏占满整行；「+」由 Tabs 的 addable 渲染在最后一个标签之后，
  // 不像外置按钮那样被甩到面板最右侧、与标签脱节。
  display: flex;
  flex-direction: column;
  gap: t.$space-1;
  padding: 0 0 t.$space-1;
  min-width: 0;

  &__nav {
    min-width: 0;
  }

  // Tabs 默认给 nav 留了下边距，这里去掉，否则与面板 gap 叠成一大块空白。
  // 底部分隔线由 card 型 Tabs 自带，不再额外画 border，避免双线。
  &__nav :deep(.n-tabs-nav) {
    margin-bottom: 0;
  }

  // 标签本体：只留「左文右 ×」需要的内边距，高度压到 26px 与面板其它小控件一致。
  // 字号必须压到 12px：naive 的 small 档仍是 14px，在 320px 面板里一行只放得下 6~7 个字，
  // 标题会被截成「这一章接…」，看起来像样式坏了。
  &__nav :deep(.n-tabs-tab) {
    height: 26px;
    padding: 0 3px 0 8px;
    font-size: 12px;
  }

  // card 型的选中态只有白底 + 主色字，暖白背景上对比很弱；补一条 2px 主色底线，
  // 让「当前在哪条会话」一眼可见，同时不破坏 naive 自带的边框与主题。
  &__nav :deep(.n-tabs-tab--active) {
    box-shadow: inset 0 -2px 0 var(--accent, #{t.$accent});
  }

  // 文字与关闭按钮要能并排：label 容器改成 flex，并让内部文字自己收缩。
  // 若把 max-width 加在这一层，会把 × 也算进 96px，文字被压得只剩几个字。
  &__nav :deep(.n-tabs-tab__label) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    max-width: none;
  }

  &__label {
    // 会话标题可能整句：封顶后省略，不限制会把标签撑到看不见第二条。
    // 宽度限制放在文字本身，× 才能稳定留在右侧不被一起截断。
    max-width: 120px;
    min-width: 0;
    // 双击重命名：cursor 提示这里可以操作，title 里也写了用法。
    cursor: text;
    @include m.ellipsis;
  }

  &__close {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    padding: 0;
    font-size: 12px;
    line-height: 1;
    // 平时半透明，避免一排 × 抢走标题的视觉重量；hover 才变清晰并转成危险色。
    color: var(--text-faint, #{t.$ink-faint});
    opacity: 0.55;
    transition: opacity t.$duration t.$ease;

    &:hover {
      color: var(--error, #{t.$error});
      opacity: 1;
    }
  }

  &__error {
    margin: 0;
    font-size: 11px;
    color: var(--error, #{t.$error});
  }

  &__footer {
    display: flex;
    justify-content: flex-end;
    gap: t.$space-2;
  }
}
</style>
