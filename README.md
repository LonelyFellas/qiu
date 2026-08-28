# qiu

一封交给你批阅的检讨书。原本是一个单文件 HTML，这里把它还原成了 React 工程。

## 跑起来

```bash
pnpm install
pnpm dev
```

## 技术栈

Vite 7 · React 19 · TypeScript · React Router 7 · Tailwind CSS 4 · ESLint + Prettier

## 结构

```
src/
├─ routes/
│  ├─ LetterPage.tsx           页面装配：抬头、书、页码、批阅、券、纸屑
│  └─ NotFound.tsx
└─ features/letter/
   ├─ typeset.ts               稿纸排版引擎（按格断行、避头尾、悬挂标点）+ 中文数字
   ├─ content.ts               信的文案，改这里就行
   ├─ useLetterBook.ts         翻页书 + 打字机（命令式，见文件头注释）
   ├─ letter.css               照搬原件的样式
   ├─ Verdict.tsx              「予以原谅」与会躲的「再想想」
   ├─ Coupons.tsx  Seal.tsx  Confetti.tsx
```

正文、附言、券面文字都在 `src/features/letter/content.ts`。

## 一处说明

稿纸上的字是直接操作 DOM 写进去的，不走 React 渲染。原因写在
`useLetterBook.ts` 开头：翻页库会接管 `.page` 元素并逐帧改样式，
打字机每 34ms 落一个字，且称呼/署名是 contentEditable ——
这三件事都跟受控渲染相冲。React 负责这块之外的全部界面。
