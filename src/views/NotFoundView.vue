<script setup lang="ts">
import { NButton } from "naive-ui";
import { useRouter } from "vue-router";

/**
 * 兜底页：手改 hash、旧版链接、或路由被删之后落到这里。
 * 不给入口的话用户只会看到一片空白，还以为是应用挂了。
 */
const router = useRouter();
</script>

<template>
  <section class="not-found">
    <h1 class="not-found__title serif">页面不存在</h1>
    <p class="not-found__hint">地址可能已经变更，或者这条链接指向的功能已被移除。</p>
    <NButton size="small" type="primary" @click="router.push('/')">返回工作台</NButton>
  </section>
</template>

<style scoped lang="scss">
@use "@/styles/tokens" as t;

.not-found {
  // 兜底页同样参与内容区容器查询，窄屏时留白交给外层统一处理。
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: t.$space-4;
  padding: t.$space-6;
  max-width: 520px;
  min-width: 0;
}

.not-found__title {
  margin: 0;
  font-size: 1.5rem;
  color: var(--text-primary, #{t.$ink});
}

.not-found__hint {
  margin: 0;
  font-size: 13px;
  color: var(--text-faint, #{t.$ink-faint});
}
</style>
