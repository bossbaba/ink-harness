<script setup lang="ts">
import { NButton, NCheckbox, NInput, NSpin, NTag } from "naive-ui";
import { computed } from "vue";
import type { IdeaProposal } from "@/types";

// 方案预览：生成中显示流式原文，生成后把可编辑字段与三幕骨架摊开给用户确认。
const props = defineProps<{
  generating: boolean;
  applying: boolean;
  modelLabel: string;
  streamText: string;
  parseError: string;
  chapterCount: number;
  sceneCount: number;
}>();

const emit = defineEmits<{
  (e: "generate"): void;
  (e: "apply"): void;
  (e: "open-models"): void;
}>();

// 方案可以为空（尚未生成），父级持有的是 `IdeaProposal | null`，这里保持同一类型避免 v-model 断言报错。
const proposal = defineModel<IdeaProposal | null>("proposal", { required: true });
const selectedTitle = defineModel<string>("selectedTitle", { required: true });
const includeOutline = defineModel<boolean>("includeOutline", { required: true });

const canApply = computed(() => {
  const value = proposal.value;
  // 还没生成方案时没有可写入的内容，直接禁用按钮；写入中由 loading 拦截点击。
  if (!value) return false;
  return Boolean(selectedTitle.value.trim() || value.premise || value.synopsis);
});

// 没有模型时给一个直达模型管理的入口，避免用户卡在错误提示上。
const needModel = computed(() => props.parseError.includes("模型管理"));
</script>

<template>
  <div class="proposal">
    <header class="proposal__head">
      <div>
        <h2 class="proposal__title">方案预览</h2>
        <p v-if="props.modelLabel" class="proposal__meta">由 {{ props.modelLabel }} 生成</p>
      </div>
      <NButton
        size="small"
        :loading="props.generating"
        :disabled="props.applying"
        @click="emit('generate')"
      >
        重新生成
      </NButton>
    </header>

    <div v-if="props.generating" class="stream">
      <NSpin size="small" />
      <pre class="stream__text">{{ props.streamText || "模型正在整理方案…" }}</pre>
    </div>

    <div v-if="props.parseError && !props.generating" class="notice">
      <p class="notice__text">{{ props.parseError }}</p>
      <NButton v-if="needModel" size="small" @click="emit('open-models')">去模型管理</NButton>
    </div>

    <template v-if="proposal && !props.generating">
      <section class="block">
        <h3 class="block__title">书名候选</h3>
        <div v-if="proposal.titles.length" class="titles">
          <!-- 书名候选是单选语义的胶囊标签，用 NButton 承载点击，样式仍保持圆角 chip。 -->
          <NButton
            v-for="title in proposal.titles"
            :key="title"
            size="small"
            class="title-chip"
            :class="{ 'title-chip--active': selectedTitle === title }"
            @click="selectedTitle = title"
          >
            {{ title }}
          </NButton>
        </div>
        <p v-else class="hint">没有候选书名，可直接沿用作品现有标题。</p>
        <label class="field">
          <span class="field__label">或手动填写书名</span>
          <NInput v-model:value="selectedTitle" placeholder="留空则沿用现有标题" size="small" />
        </label>
      </section>

      <div class="grid">
        <label class="field">
          <span class="field__label">一句话梗概</span>
          <NInput v-model:value="proposal.premise" size="small" placeholder="主角 + 目标 + 阻力" />
        </label>
        <label class="field">
          <span class="field__label">目标读者</span>
          <NInput v-model:value="proposal.audience" size="small" placeholder="读者画像" />
        </label>
        <label class="field">
          <span class="field__label">叙事风格</span>
          <NInput v-model:value="proposal.style" size="small" placeholder="风格与基调" />
        </label>
      </div>

      <label class="field">
        <span class="field__label">作品简介</span>
        <NInput
          v-model:value="proposal.synopsis"
          type="textarea"
          :rows="6"
          placeholder="200~300 字，可用于作品详情页"
        />
      </label>

      <section class="block">
        <header class="block__head">
          <h3 class="block__title">三幕大纲骨架</h3>
          <NTag size="tiny" :bordered="false">
            {{ props.chapterCount }} 章 · {{ props.sceneCount }} 场景
          </NTag>
        </header>
        <p v-if="!proposal.outline.length" class="hint">
          这次没有生成大纲骨架，写入时只更新作品信息。
        </p>
        <div v-else class="acts">
          <article v-for="act in proposal.outline" :key="act.act" class="act">
            <h4 class="act__title">第 {{ act.act }} 幕</h4>
            <ul class="act__chapters">
              <li v-for="chapter in act.chapters" :key="chapter.title" class="chapter">
                <div class="chapter__head">
                  <span class="chapter__title">{{ chapter.title }}</span>
                  <span class="chapter__count">{{ chapter.scenes.length }} 场景</span>
                </div>
                <p v-if="chapter.summary" class="chapter__summary">{{ chapter.summary }}</p>
              </li>
            </ul>
          </article>
        </div>
        <NCheckbox v-model:checked="includeOutline" :disabled="!proposal.outline.length">
          同时写入三幕大纲骨架（后续可在大纲页拖拽调整）
        </NCheckbox>
      </section>

      <div class="apply">
        <NButton
          size="small"
          type="primary"
          :loading="props.applying"
          :disabled="!canApply"
          @click="emit('apply')"
        >
          写入作品
        </NButton>
        <span class="hint">写入会覆盖作品当前的标题、梗概、简介、读者画像与风格。</span>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.proposal {
  display: flex;
  flex-direction: column;
  gap: t.$space-4;
  min-width: 0;
  container-type: inline-size;

  &__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: t.$space-3;
  }

  &__title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
  }

  &__meta {
    margin: 2px 0 0;
    font-size: 10px;
    color: var(--text-faint, #{t.$ink-faint});
  }
}

.stream {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  padding: t.$space-3;
  border: 1px dashed var(--divider, #{t.$divider});
  border-radius: t.$radius-sm;
  background: var(--bg-sunken);

  &__text {
    margin: 0;
    max-height: 240px;
    overflow: auto;
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-soft, #{t.$ink-soft});
    white-space: pre-wrap;
    word-break: break-word;
  }
}

.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: t.$space-3;
  padding: t.$space-3;
  border-radius: t.$radius-sm;
  background: var(--error-soft);

  &__text {
    margin: 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--error, #{t.$error});
  }
}

.block {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  padding-top: t.$space-3;
  border-top: 1px solid var(--divider, #{t.$divider});

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-2;
  }

  &__title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
  }
}

.titles {
  display: flex;
  flex-wrap: wrap;
  gap: t.$space-2;
}

// 双写类名压过 NButton 的默认高度与内边距，保留胶囊候选标签的紧凑外观。
.title-chip.title-chip {
  height: auto;
  padding: 5px 12px;
  border: 1px solid var(--divider, #{t.$divider});
  border-radius: 999px;
  background: transparent;
  color: var(--text-primary, #{t.$ink});
  font-size: 12px;

  &.title-chip--active {
    border-color: var(--accent, #{t.$accent});
    color: var(--accent, #{t.$accent});
  }
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: t.$space-3;

  @container (max-width: 760px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  min-width: 0;

  &__label {
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});
  }
}

.hint {
  margin: 0;
  font-size: 10px;
  line-height: 1.6;
  color: var(--text-faint, #{t.$ink-faint});
}

.acts {
  display: flex;
  flex-direction: column;
  gap: t.$space-3;
  max-height: 320px;
  padding-right: t.$space-1;
  overflow: auto;
}

.act {
  &__title {
    margin: 0 0 t.$space-2;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__chapters {
    display: flex;
    flex-direction: column;
    gap: t.$space-1;
    margin: 0;
    padding: 0;
    list-style: none;
  }
}

.chapter {
  padding: t.$space-2;
  border-radius: t.$radius-sm;
  background: var(--bg-app);

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-2;
  }

  &__title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
    @include m.ellipsis;
  }

  &__count {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__summary {
    margin: 2px 0 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--text-soft, #{t.$ink-soft});
  }
}

.apply {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: t.$space-3;
  padding-top: t.$space-3;
  border-top: 1px solid var(--divider, #{t.$divider});
}
</style>
