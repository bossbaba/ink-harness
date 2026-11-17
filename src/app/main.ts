import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";

// 第三方样式先加载，桥接层（main.scss 内的 _bridge）随后覆盖其 token。
import "@macvue/core/style.css";
import "@/styles/main.scss";

createApp(App).use(createPinia()).use(router).mount("#app");
