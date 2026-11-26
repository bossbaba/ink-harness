<script setup lang="ts">
import { NButton, NSpin } from "naive-ui";
import AppIcon from "@/components/common/AppIcon.vue";

/**
 * 审稿页的运行/空状态区：
 * - 审读中：进度卡 + 骨架，说明正在读哪一章、已收到多少字；
 * - 未开始：左对齐的三步引导，与工具条同宽，替代原先悬浮在页面中间的小卡片。
 *
 * 拆成子组件有两个原因：页面只该负责「工具条 + 报告」，运行态的模板与样式
 * 搬出去后单文件能守住 500 行；两种状态共用同一块版位，切换时页面不会跳动。
 */
defineProps<{
  /** 是否正在跑审读。 */
  running: boolean;
  /** 是否还在读取作品与章节：此时两种状态都不渲染，避免先闪一下引导再变进度。 */
  loading: boolean;
  /** 后端/模型返回的当前步骤文案。 */
  progress: string;
  /** 流式已收到的字数。 */
  received: number;
  /** 当前章节标题；全书概览时为空串。 */
  chapterTitle: string;
  /** 是否具备开始条件（有章节、未在运行）。 */
  canRun: boolean;
}>();

const emit = defineEmits<{ start: [] }>();
</script>

<template>
  <section v-if="running" class="progress-card">
    <div class="progress-card__head">
      <NSpin size="small" />
      <div class="progress-card__text">
        <p class="progress-card__title">
          正在审读{{ chapterTitle ? `：${chapterTitle}` : "全书概览" }}
        </p>
        <p class="progress-card__hint">
          {{ progress || "模型正在读文本…" }}
          <template v-if="received"> · 已收到 {{ received }} 字</template>
        </p>
      </div>
    </div>
    <!-- 骨架只是占位，不承载信息，对读屏隐藏。 -->
    <div class="progress-card__skeleton" aria-hidden="true">
      <span class="progress-card__line" />
      <span class="progress-card__line" />
      <span class="progress-card__line" />
    </div>
  </section>

  <section v-else-if="!loading" class="guide">
    <div class="guide__head">
      <span class="guide__badge">
        <AppIcon name="review" :size="22" />
      </span>
      <div class="guide__text">
        <p class="guide__title">还没有审读报告</p>
        <p class="guide__desc">
          「本章」连语言一起细看；「全书概览」只查结构与一致性，速度快、不读正文。
        </p>
      </div>
    </div>
    <ol class="guide__steps">
      <li><span class="guide__no">1</span>选范围与章节</li>
      <li><span class="guide__no">2</span>开始审读</li>
      <li><span class="guide__no">3</span>逐条采纳，应用可替换的修改</li>
    </ol>
    <NButton size="small" type="primary" :disabled="!canRun" @click="emit('start')">
      开始审读
    </NButton>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

// 审读中：用骨架占住内容区，高度与真实报告接近，出结果时页面不会突然跳一下。
.progress-card {
  display: flex;
  flex-direction: column;
  gap: t.$space-4;
  margin-top: t.$space-4;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  &__head {
    display: flex;
    align-items: flex-start;
    gap: t.$space-3;
  }

  &__text {
    min-width: 0;
  }

  &__title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
    @include m.ellipsis;
  }

  &__hint {
    margin: 4px 0 0;
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__skeleton {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
  }

  &__line {
    height: 10px;
    border-radius: t.$radius-sm;
    background: linear-gradient(
      90deg,
      var(--bg-sunken, #{t.$paper-sunken}) 25%,
      var(--bg-app, #{t.$paper}) 37%,
      var(--bg-sunken, #{t.$paper-sunken}) 63%
    );
    background-size: 400% 100%;
    animation: review-shimmer 1.4s ease infinite;

    &:nth-child(2) {
      width: 92%;
    }

    &:nth-child(3) {
      width: 64%;
    }
  }
}

@keyframes review-shimmer {
  from {
    background-position: 100% 0;
  }

  to {
    background-position: 0 0;
  }
}

// 空状态：与工具条同宽的左对齐引导，替代原先悬浮在中间的小卡片。
.guide {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: t.$space-3;
  margin-top: t.$space-4;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  // 设计稿 3:975：引导卡内的主操作压到 28px，与页头工具条同一档。
  :deep(.n-button) {
    height: 28px;
    font-size: 11px;
  }

  &__head {
    display: flex;
    align-items: flex-start;
    gap: t.$space-3;
    min-width: 0;
  }

  &__badge {
    display: grid;
    place-items: center;
    flex: none;
    width: 40px;
    height: 40px;
    color: var(--accent, #{t.$accent});
    background: var(--accent-soft, #{t.$accent-soft});
    border-radius: t.$radius-lg;
  }

  &__text {
    min-width: 0;
  }

  &__title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
  }

  &__desc {
    max-width: 640px;
    margin: 4px 0 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__steps {
    display: flex;
    flex-wrap: wrap;
    gap: t.$space-3;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__steps li {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__no {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--bg-sunken, #{t.$paper-sunken});
    font-size: 10px;
    color: var(--text-faint, #{t.$ink-faint});
  }
}

// 窄面板：步骤竖排，避免三个步骤挤成两行半。
@container (max-width: 620px) {
  .guide__steps {
    flex-direction: column;
    gap: t.$space-2;
  }
}
</style>
