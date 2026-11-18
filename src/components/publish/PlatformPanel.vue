<script setup lang="ts">
import { NCheckbox, NDatePicker, NInput } from "naive-ui";
import { PUBLISH_PLATFORMS, type PublishEntry } from "@/types";

/** 发布清单：提醒各平台的口味差异，排期记在本机，不替作者真的投稿。 */
defineProps<{
  plan: { selected: string[]; entries: PublishEntry[] };
}>();

const emit = defineEmits<{
  toggle: [key: string];
  entry: [platform: string, patch: Partial<PublishEntry>];
}>();

function entryOf(entries: PublishEntry[], key: string): PublishEntry | undefined {
  return entries.find((entry) => entry.platform === key);
}

// NDatePicker 的 value 是时间戳，本地计划里存的是 yyyy-MM-dd，这里做一层转换。
function dateValue(entry: PublishEntry | undefined): number | null {
  if (!entry?.date) return null;
  const time = Date.parse(entry.date);
  return Number.isNaN(time) ? null : time;
}

function toDateString(value: unknown): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  return new Date(value).toISOString().slice(0, 10);
}
</script>

<template>
  <section class="platforms">
    <p class="platforms__hint">
      勾选准备投稿的平台，记下计划日期与注意事项。清单只留在浏览器本地。
    </p>

    <div class="platforms__list">
      <article v-for="platform in PUBLISH_PLATFORMS" :key="platform.key" class="platform">
        <header class="platform__head">
          <NCheckbox
            :checked="plan.selected.includes(platform.key)"
            @update:checked="emit('toggle', platform.key)"
          >
            <strong>{{ platform.label }}</strong>
          </NCheckbox>
          <span class="platform__note">{{ platform.note }}</span>
        </header>
        <div class="platform__fields">
          <NDatePicker
            :value="dateValue(entryOf(plan.entries, platform.key))"
            type="date"
            size="small"
            placeholder="计划发布日期"
            @update:value="(value) => emit('entry', platform.key, { date: toDateString(value) })"
          />
          <NInput
            :value="entryOf(plan.entries, platform.key)?.note ?? ''"
            size="small"
            placeholder="备注：样章、字数要求、联系人…"
            @update:value="(value: string) => emit('entry', platform.key, { note: value })"
          />
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.platforms {
  margin-top: t.$space-4;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));
  min-width: 0;

  &__hint {
    margin: 0;
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: t.$space-3;
    margin-top: t.$space-3;
    min-width: 0;
  }
}

.platform {
  padding: t.$space-3;
  border: 1px solid var(--divider, #{t.$divider});
  border-radius: t.$radius-md;
  background: var(--bg-app);
  min-width: 0;

  &__head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: t.$space-3;
  }

  &__note {
    font-size: 11px;
    line-height: 1.6;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__fields {
    display: grid;
    grid-template-columns: minmax(0, 180px) minmax(0, 1fr);
    gap: t.$space-3;
    margin-top: t.$space-3;
    min-width: 0;
  }
}

@container (max-width: 620px) {
  .platform__fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
