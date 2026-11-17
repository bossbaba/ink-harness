<script setup lang="ts">
import { MacButton } from "@macvue/core";
import { NInput, NModal, NSelect, NSpace } from "naive-ui";
import { ref } from "vue";
import { projectService } from "@/services/projectService";
import type { NewProject } from "@/types";

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{
  (e: "update:show", value: boolean): void;
  (e: "created", project: { id: string; title: string }): void;
}>();

const title = ref("");
const genre = ref("");
const premise = ref("");
const privacy = ref<"any" | "local-only">("any");
const error = ref("");
const busy = ref(false);

const genreOptions = [
  { label: "小说", value: "小说" },
  { label: "非虚构", value: "非虚构" },
  { label: "剧本", value: "剧本" },
  { label: "其他", value: "其他" },
];
const privacyOptions = [
  { label: "任意模型", value: "any" },
  { label: "仅本地模型（隐私）", value: "local-only" },
];

// 关闭只改弹窗开合状态；创建成功另行 emit created，让工作台刷新作品列表。
function close() {
  emit("update:show", false);
}

async function submit() {
  // 标题必填，其余字段允许留空由后端补默认值。
  if (!title.value.trim()) {
    error.value = "请输入作品标题";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const input: NewProject = {
      title: title.value,
      genre: genre.value,
      premise: premise.value,
      privacy: privacy.value,
    };
    const created = await projectService.create(input);
    title.value = "";
    genre.value = "";
    premise.value = "";
    emit("created", { id: created.id, title: created.title });
    close();
  } catch (err) {
    error.value = String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    title="新建作品"
    :style="{ width: '560px', maxWidth: 'calc(100vw - 48px)' }"
    :bordered="false"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="form">
      <label class="field">
        <span class="field__label">作品标题</span>
        <NInput v-model:value="title" placeholder="给你的作品起个名字" />
      </label>
      <div class="row">
        <label class="field">
          <span class="field__label">类型</span>
          <NSelect v-model:value="genre" :options="genreOptions" placeholder="选择类型" clearable />
        </label>
        <label class="field">
          <span class="field__label">模型隐私</span>
          <NSelect v-model:value="privacy" :options="privacyOptions" />
        </label>
      </div>
      <label class="field">
        <span class="field__label">一句话梗概</span>
        <NInput v-model:value="premise" type="textarea" :rows="3" placeholder="这个故事讲什么？" />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #footer>
      <NSpace justify="end">
        <MacButton @click="close">取消</MacButton>
        <MacButton variant="prominent" :disabled="busy" @click="submit">
          {{ busy ? "创建中…" : "创建作品" }}
        </MacButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;

.form {
  display: flex;
  flex-direction: column;
  gap: t.$space-4;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: t.$space-4;
}

.field {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;

  &__label {
    font-size: 12px;
    color: var(--text-soft, #{t.$ink-soft});
  }
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--error, #{t.$error});
}
</style>
