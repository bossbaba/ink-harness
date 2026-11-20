<script setup lang="ts">
import { NButton, NInput, NModal, NSpace } from "naive-ui";
import { ref } from "vue";
import LoadingState from "@/components/common/LoadingState.vue";

// 上下文预览：把「作品信息 + 设定库 + 大纲 + 伏笔」的纯文本展示出来，可直接复制给模型。
const props = defineProps<{
  busy: boolean;
  text: string;
}>();

const emit = defineEmits<(e: "refresh") => void>();

const show = defineModel<boolean>("show", { required: true });
const copied = ref(false);

async function copy(): Promise<void> {
  if (!props.text) return;
  try {
    await navigator.clipboard.writeText(props.text);
    copied.value = true;
    // 2 秒后恢复按钮文案，避免一直显示「已复制」造成误解。
    window.setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    // 部分 WebView 会拒绝剪贴板权限，此时让用户手动全选复制。
    copied.value = false;
  }
}
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    title="作品上下文（可引用）"
    :style="{ width: '760px', maxWidth: 'calc(100vw - 48px)' }"
    :bordered="false"
  >
    <p class="hint">
      这份文本汇总了作品信息、设定库、大纲与伏笔，后续写作台与 Copilot 会直接把它作为上下文注入。
    </p>

    <div class="body">
      <div v-if="props.busy" class="body__loading">
        <LoadingState variant="inline" text="正在汇总作品上下文…" />
      </div>
      <NInput
        v-else
        class="body__input"
        :value="props.text"
        type="textarea"
        :rows="18"
        readonly
        placeholder="暂无内容"
      />
    </div>

    <template #footer>
      <NSpace justify="end">
        <NButton size="small" :loading="props.busy" @click="emit('refresh')"> 重新生成 </NButton>
        <NButton size="small" type="primary" :disabled="props.busy || !props.text" @click="copy">
          {{ copied ? "已复制" : "复制全文" }}
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;

.hint {
  margin: 0 0 t.$space-3;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-faint, #{t.$ink-faint});
}

.body {
  min-height: 220px;

  &__loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 220px;
  }

  &__input {
    width: 100%;
  }
}
</style>
