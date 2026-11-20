<script setup lang="ts">
import { NButton } from "naive-ui";
import { useRouter } from "vue-router";
import LoadingState from "@/components/common/LoadingState.vue";
import IdeationForm from "@/components/ideation/IdeationForm.vue";
import IdeationProposal from "@/components/ideation/IdeationProposal.vue";
import IdeationStepList from "@/components/ideation/IdeationStepList.vue";
import { useIdeationWizard } from "@/composables/useIdeationWizard";

// 作品构思向导：页面只负责组装步骤条、访谈表单与方案预览。
const props = defineProps<{ projectId: string }>();
const router = useRouter();

const {
  project,
  answers,
  step,
  maxStep,
  proposal,
  selectedTitle,
  includeOutline,
  generating,
  applying,
  applied,
  outlineCreated,
  streamText,
  parseError,
  modelLabel,
  error,
  canNext,
  outlineSummary,
  goStep,
  next,
  prev,
  resetProposal,
  generate,
  apply,
} = useIdeationWizard(props.projectId);

function openOutline(): void {
  if (!project.value) return;
  void router.push({ name: "project-outline", params: { projectId: project.value.id } });
}

function openBible(): void {
  if (!project.value) return;
  void router.push({ name: "project-bible", params: { projectId: project.value.id } });
}

function openModels(): void {
  void router.push({ name: "models" });
}

function backWorkspace(): void {
  void router.push({ name: "workspace" });
}
</script>

<template>
  <div class="ideation">
    <header class="ideation__header">
      <div>
        <h1 class="ideation__title serif">
          {{ project ? `《${project.title}》· 构思向导` : "构思向导" }}
        </h1>
        <p class="ideation__subtitle">
          分步回答几个问题，AI 会整理成书名、梗概、简介、读者画像与三幕骨架；每一步都可以回头修改。
        </p>
      </div>
      <NButton size="small" :disabled="!project" @click="openOutline">打开大纲</NButton>
    </header>

    <p v-if="error" class="ideation__error">{{ error }}</p>

    <LoadingState v-if="!project && !error" text="正在载入作品…" />

    <div v-else-if="project" class="ideation__body">
      <IdeationStepList :current="step" :max-reachable="maxStep" @select="goStep" />

      <section class="panel">
        <template v-if="applied">
          <div class="done">
            <h2 class="done__title serif">方案已写入作品</h2>
            <p class="done__text">
              标题、梗概、简介、读者画像与风格已更新。
              <template v-if="outlineCreated">
                同时生成了 {{ outlineSummary.chapters }} 章 /
                {{ outlineSummary.scenes }} 个场景，已写入作品大纲。
              </template>
            </p>
            <div class="done__actions">
              <NButton v-if="outlineCreated" size="small" type="primary" @click="openOutline">
                去大纲调整
              </NButton>
              <NButton size="small" @click="openBible">打开设定库</NButton>
              <NButton size="small" @click="resetProposal">重新构思</NButton>
              <NButton size="small" @click="backWorkspace">返回工作台</NButton>
            </div>
          </div>
        </template>

        <template v-else>
          <IdeationForm v-if="step <= 2" v-model:answers="answers" :step="step" />
          <IdeationProposal
            v-else
            v-model:proposal="proposal"
            v-model:selected-title="selectedTitle"
            v-model:include-outline="includeOutline"
            :generating="generating"
            :applying="applying"
            :model-label="modelLabel"
            :stream-text="streamText"
            :parse-error="parseError"
            :chapter-count="outlineSummary.chapters"
            :scene-count="outlineSummary.scenes"
            @generate="generate"
            @apply="apply"
            @open-models="openModels"
          />

          <footer v-if="step <= 2" class="actions">
            <NButton v-if="step > 0" size="small" :disabled="generating" @click="prev">
              上一步
            </NButton>
            <span v-if="!canNext" class="actions__hint">
              先填写{{ step === 0 ? "你的灵感" : "主角" }}再继续。
            </span>
            <span class="actions__spacer" />
            <NButton v-if="step < 2" size="small" type="primary" :disabled="!canNext" @click="next">
              下一步
            </NButton>
            <NButton
              v-else
              size="small"
              type="primary"
              :disabled="!canNext || generating"
              @click="generate"
            >
              {{ generating ? "生成中…" : "生成方案" }}
            </NButton>
          </footer>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;
@use "../styles/mixins" as m;

.ideation {
  max-width: 1200px;
  min-width: 0;
  margin: 0 auto;
  padding: t.$space-6;
  container-type: inline-size;

  &__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: t.$space-4;
  }

  &__title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }

  &__subtitle,
  &__error {
    margin: t.$space-2 0 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__error {
    color: var(--error, #{t.$error});
  }

  &__body {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: t.$space-4;
    margin-top: t.$space-5;
    align-items: start;
    min-width: 0;

    @container (max-width: 780px) {
      grid-template-columns: minmax(0, 1fr);
    }
  }
}

.panel {
  display: flex;
  flex-direction: column;
  gap: t.$space-4;
  min-width: 0;
  min-height: 360px;
  padding: t.$space-5;
  @include m.card-surface(var(--bg-surface));
}

.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: t.$space-3;
  padding-top: t.$space-4;
  border-top: 1px solid var(--divider, #{t.$divider});

  &__hint {
    font-size: 11px;
    color: var(--warning, #{t.$warning});
  }

  &__spacer {
    flex: 1;
  }
}

.done {
  display: flex;
  flex-direction: column;
  gap: t.$space-3;
  padding: t.$space-4;
  border-radius: t.$radius-md;
  background: var(--bg-sunken);

  &__title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
  }

  &__text {
    margin: 0;
    font-size: 12px;
    line-height: 1.8;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: t.$space-2;
  }
}

@container (max-width: 620px) {
  .ideation__header {
    flex-direction: column;
  }
}
</style>
