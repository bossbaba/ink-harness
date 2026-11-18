/** 分段控件选项：value 统一用 string，页面侧再断言回自己的字面量联合类型。 */
export interface SegmentOption {
  label: string;
  value: string;
  disabled?: boolean;
}
