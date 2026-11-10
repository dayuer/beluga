import './style.css';
import { renderHome } from './pages/home';

// 页面入口。新增页面:在 src/pages/ 加文件,并在这里的 routes 里登记。
const routes: Record<string, (root: HTMLElement) => void> = {
  '/': renderHome,
};

const root = document.getElementById('app')!;
const render = () => (routes[location.pathname] ?? routes['/'])(root);
render();
window.addEventListener('popstate', render);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
