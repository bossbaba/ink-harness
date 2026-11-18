import { createPinia } from "pinia";
import { createApp } from "vue";
import { notifyError } from "@/composables/useNotice";
import App from "./App.vue";
import router from "./router";

import "@/styles/main.scss";

const app = createApp(App);

/**
 * 全局兜底：组件渲染/生命周期里抛出的错误会走到这里。
 * 没有这层时，Vue 只把异常打到控制台，用户看到的是「点了没反应」。
 */
app.config.errorHandler = (err, _instance, info) => {
  notifyError(err, `界面异常（${info}）`);
};

// 未处理的 Promise 拒绝（典型是 `void someAction()`）：同样要给用户一个提示。
window.addEventListener("unhandledrejection", (event) => {
  notifyError(event.reason);
});

app.use(createPinia()).use(router).mount("#app");
