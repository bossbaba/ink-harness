<script setup lang="ts">
import { NButton } from "naive-ui";
import { onErrorCaptured, ref, watch } from "vue";
import { describeRenderError, type RenderErrorDetail } from "@/utils/errorBoundary";

/**
 * 组件级错误边界：只让出错的这一块降级，不让整页变成空白。
 *
 * 全局 `app.config.errorHandler` 只能弹提示，旧页面仍停在出错前的状态，
 * 用户点什么都没反应。这里接住后代组件的渲染/生命周期错误，展示可重试的卡片；
 * 不拦截错误冒泡，全局提示与 Trace 仍照常记录，便于事后排查。
 */
const props = withDefaults(
  defineProps<{
    /** 外部作用域标识：变化时清掉上一次的降级态（典型是路由地址）。 */
    resetKey?: string | number;
    /** 降级卡片标题：说清是哪一块没显示出来。 */
    title?: string;
    /** 补充说明：告诉用户重试无效时还能做什么。 */
    description?: string;
    /** 重试按钮文案。 */
    retryLabel?: string;
    /** page 用于整页主内容，inline 用于面板内的局部降级。 */
    variant?: "page" | "inline";
  }>(),
  {
    title: "这一块没能显示",
    description: "一般是临时故障或数据格式异常，重试会重新载入这一块。",
    retryLabel: "重试",
    variant: "page",
  },
);

const emit = defineEmits<{
  /** 上报给外层做日志记录；hook 是 Vue 给出的出错阶段（render / mounted 等）。 */
  error: [error: unknown, hook: string];
  /** 作者点重试：外层可借此换 key，强制重建出错的子树。 */
  retry: [];
}>();

const failed = ref(false);
const detail = ref<RenderErrorDetail>({ message: "", hint: "" });

function clearError(): void {
  failed.value = false;
  detail.value = { message: "", hint: "" };
}

// 换了页面/作用域就别再拿上一页的失败卡片糊在新页面上；
// 同时发 retry 让外层换 key，防止 KeepAlive 再把那棵出错的旧子树激活。
watch(
  () => props.resetKey,
  () => {
    if (!failed.value) return;
    clearError();
    emit("retry");
  },
);

onErrorCaptured((err, _instance, hook) => {
  failed.value = true;
  detail.value = describeRenderError(err);
  emit("error", err, hook);
  // 刻意不返回 false：保留全局提示栈与错误上报，避免这里把异常吞掉。
});

function retry(): void {
  // 先通知外层换 key，再清除失败态；反过来的话会先重渲染那棵仍然出错的旧子树。
  emit("retry");
  clearError();
}
</script>

<template>
  <!-- 正常态用 display:contents，不额外包一层盒子，避免破坏父级的栅格/弹性布局。 -->
  <div v-if="!failed" class="error-boundary error-boundary--live"><slot /></div>
  <div
    v-else
    class="error-boundary error-boundary--fallback"
    :class="{ 'error-boundary--inline': variant === 'inline' }"
    role="alert"
    aria-live="assertive"
  >
    <p class="error-boundary__title">{{ title }}</p>
    <p class="error-boundary__message">{{ detail.message }}</p>
    <p v-if="detail.hint" class="error-boundary__hint">{{ detail.hint }}</p>
    <p v-if="description" class="error-boundary__desc">{{ description }}</p>
    <NButton size="small" type="primary" @click="retry">{{ retryLabel }}</NButton>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/tokens" as t;
@use "@/styles/mixins" as m;

.error-boundary {
  min-width: 0;

  &--live {
    display: contents;
  }

  // 错误卡片比空状态更显眼，但高度由内容决定，不把整屏撑满。
  &--fallback {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: t.$space-3;
    padding: t.$space-5 t.$space-4;
    text-align: center;
    @include m.card-surface(var(--bg-surface, #{t.$paper-raised}));
  }

  &--inline {
    padding: t.$space-4;
  }

  &__title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
  }

  &__message {
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--error, #{t.$error});
    word-break: break-word;
  }

  &__hint,
  &__desc {
    margin: 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--text-soft, #{t.$ink-soft});
  }
}
</style>
