<script setup lang="ts">
import { NInput, NSelect } from "naive-ui";
import type { IdeationAnswers, NovelLength } from "@/types";

// 访谈表单：按 step 切换字段；内容直接写回父级 answers，切换步骤不丢数据。
defineProps<{ step: number }>();

const answers = defineModel<IdeationAnswers>("answers", { required: true });

const lengthOptions: Array<{ label: string; value: NovelLength }> = [
  { label: "短篇（3 万字以内）", value: "短篇" },
  { label: "中篇（3~15 万字）", value: "中篇" },
  { label: "长篇（15 万字以上）", value: "长篇" },
];
</script>

<template>
  <div class="form">
    <template v-if="step === 0">
      <label class="field">
        <span class="field__label">一句话灵感</span>
        <NInput
          v-model:value="answers.inspiration"
          type="textarea"
          :rows="3"
          placeholder="例如：一个能听见他人记忆的调音师，被迫为杀死自己师父的凶手调琴。"
        />
        <span class="field__hint">不用完整，写出最想写的那个画面或冲突即可。</span>
      </label>
      <div class="row">
        <label class="field">
          <span class="field__label">类型</span>
          <NInput v-model:value="answers.genre" placeholder="悬疑 / 科幻 / 奇幻 / 现实" size="small" />
        </label>
        <label class="field">
          <span class="field__label">目标读者</span>
          <NInput
            v-model:value="answers.audience"
            placeholder="例如：偏爱社会派悬疑的 20~35 岁读者"
            size="small"
          />
        </label>
      </div>
    </template>

    <template v-else-if="step === 1">
      <label class="field">
        <span class="field__label">主角</span>
        <NInput
          v-model:value="answers.protagonist"
          type="textarea"
          :rows="3"
          placeholder="他是谁？最想要什么？有什么无法回避的弱点或过去？"
        />
      </label>
      <label class="field">
        <span class="field__label">对手或阻力</span>
        <NInput
          v-model:value="answers.antagonist"
          type="textarea"
          :rows="2"
          placeholder="谁在阻止主角？也可能是环境、规则或主角自己。"
        />
      </label>
      <label class="field">
        <span class="field__label">核心冲突</span>
        <NInput
          v-model:value="answers.conflict"
          type="textarea"
          :rows="2"
          placeholder="主角的目标与阻力如何正面相撞，最坏会发生什么？"
        />
      </label>
    </template>

    <template v-else>
      <label class="field">
        <span class="field__label">世界与时代</span>
        <NInput
          v-model:value="answers.world"
          type="textarea"
          :rows="3"
          placeholder="故事发生在哪里、什么年代，有哪些不能违反的规则？"
        />
      </label>
      <div class="row">
        <label class="field">
          <span class="field__label">叙事风格</span>
          <NInput
            v-model:value="answers.style"
            placeholder="例如：冷峻克制、第一人称限知"
            size="small"
          />
        </label>
        <label class="field">
          <span class="field__label">篇幅预期</span>
          <NSelect v-model:value="answers.length" :options="lengthOptions" size="small" />
        </label>
      </div>
      <p class="form__note">
        下一步会让 AI 基于以上信息生成书名候选、梗概、简介、读者画像与三幕大纲骨架；生成后仍可逐项修改。
      </p>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;

.form {
  display: flex;
  flex-direction: column;
  gap: t.$space-4;
  container-type: inline-size;

  &__note {
    margin: 0;
    padding: t.$space-3;
    border-radius: t.$radius-sm;
    background: var(--bg-sunken);
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-soft, #{t.$ink-soft});
  }
}

.row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: t.$space-3;

  @container (max-width: 560px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  min-width: 0;

  &__label {
    font-size: 12px;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__hint {
    font-size: 10px;
    line-height: 1.6;
    color: var(--text-faint, #{t.$ink-faint});
  }
}
</style>
