<script setup lang="ts">
import { NDrawer, NDrawerContent } from "naive-ui";
import WritingCopilotPanel from "@/components/writing/WritingCopilotPanel.vue";
import type { CopilotMessage, CopilotReference } from "@/types";

/**
 * Copilot 抽屉外壳：只负责「抽屉 + 内容面板」的摆放，对话状态与请求都在页面侧。
 *
 * 用抽屉而不是常驻第三栏：写作台已经有「章节列表 + 编辑器」两栏，
 * 再加一栏会把正文挤到 500px 以下；关掉遮罩后抽屉打开时仍可继续打字。
 */
const show = defineModel<boolean>("show", { required: true });

defineProps<{
  projectId: string;
  messages: CopilotMessage[];
  streaming: boolean;
  error: string;
  contextChars: number;
  references: CopilotReference[];
}>();

const emit = defineEmits<{
  (event: "send", text: string): void;
  (event: "stop"): void;
  (event: "clear"): void;
  (event: "pick", reference: CopilotReference): void;
  (event: "unpick", reference: CopilotReference): void;
  (event: "insert", text: string): void;
}>();
</script>

<template>
  <NDrawer v-model:show="show" :width="380" placement="right" :mask="false" :block-scroll="false">
    <NDrawerContent title="AI 对话" closable>
      <WritingCopilotPanel
        :project-id="projectId"
        :messages="messages"
        :streaming="streaming"
        :error="error"
        :context-chars="contextChars"
        :references="references"
        @send="emit('send', $event)"
        @stop="emit('stop')"
        @clear="emit('clear')"
        @pick="emit('pick', $event)"
        @unpick="emit('unpick', $event)"
        @insert="emit('insert', $event)"
      />
    </NDrawerContent>
  </NDrawer>
</template>
