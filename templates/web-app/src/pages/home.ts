// 示例页面:一个能增删的清单,数据存在手机浏览器本地(localStorage)。替换成客户要的页面。
const KEY = 'items';

const load = (): string[] => JSON.parse(localStorage.getItem(KEY) ?? '[]');
const save = (items: string[]) => localStorage.setItem(KEY, JSON.stringify(items));

export function renderHome(root: HTMLElement): void {
  root.innerHTML = `
    <header class="bar"><h1>我的清单</h1></header>
    <main class="page">
      <form id="add" class="row">
        <input id="text" placeholder="写点什么…" autocomplete="off" required />
        <button type="submit">添加</button>
      </form>
      <ul id="list" class="list"></ul>
      <p id="empty" class="muted">还没有内容</p>
    </main>`;
  const list = root.querySelector<HTMLUListElement>('#list')!;
  const empty = root.querySelector<HTMLElement>('#empty')!;
  const input = root.querySelector<HTMLInputElement>('#text')!;

  const draw = () => {
    const items = load();
    empty.hidden = items.length > 0;
    list.innerHTML = '';
    items.forEach((text, i) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = text;
      const del = document.createElement('button');
      del.textContent = '删除';
      del.className = 'ghost';
      del.onclick = () => {
        save(load().filter((_, j) => j !== i));
        draw();
      };
      li.append(span, del);
      list.append(li);
    });
  };

  root.querySelector<HTMLFormElement>('#add')!.onsubmit = (e) => {
    e.preventDefault();
    save([...load(), input.value.trim()]);
    input.value = '';
    draw();
  };
  draw();
}
