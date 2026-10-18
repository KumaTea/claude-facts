# 关于 Claude 的事实

摘自[知乎](https://www.zhihu.com/question/2086853485602121257)；你也可能对
[The Jeff Dean Facts](https://github.com/LRitzdorf/TheJeffDeanFacts) 感兴趣。

另外同时发布 Claude Code 插件 `spinner-facts`,
将加载中的词语如 baking, pondering 等替换为从文本中随机提取的一句话。
如果句子过长，会像LED一样在屏幕上滚动。

```
✻ Claude 封号的速度极快。快到有些账号是先被封、后被注册的。… (4s · ↓ 82 tokens)
```

## 安装

需要 Claude Code **2.1.302+**

该插件使用 Claude Code 的 plugin hooks API

```sh
claude plugin install spinner-facts --marketplace KumaTea/claude-facts
```

如果已经克隆到本地：

```sh
claude plugin install spinner-facts --marketplace /path/to/claude-facts
```

随后开启新的 Claude Code 会话，或在已有会话运行 `/reload-plugins`

单次临时使用：

```sh
claude --plugin-dir /path/to/claude-facts
```

## 自定义文本

更改文本文件：

```sh
claude plugin install spinner-facts --marketplace OWNER/claude-facts --config 'factsFile=~/my-facts.txt'
```

临时更改文件：

```sh
echo '{"factsFile": "~/my-facts.txt"}' | claude plugin configure spinner-facts@spinner-facts --values-stdin
```

在 Claude Code 内部修改：`/plugin configure spinner-facts@spinner-facts`

本地运行时，直接修改 `facts.txt` 也可以。

### 选项

| Option | Default | What it does |
| --- | --- | --- |
| `factsFile` | the bundled `facts.txt` | The file to read facts from. |
| `width` | `0` (fit the terminal) | How many columns the text may use before it scrolls. |
| `speedMs` | `150` | Milliseconds per one-character scroll step. The minimum is 100, because Claude Code redraws at most 10 times a second. |
| `rotateLoops` | `10` | How many times a fact too long to fit scrolls round before the next fact follows it in. `0` keeps one fact for the whole turn. |
| `rotateSeconds` | `60` | How many seconds a fact that fits stays before the next one replaces it. `0` keeps one fact for the whole turn. |

## 卸载

```sh
claude plugin disable spinner-facts@spinner-facts     # keep it installed, stop using it
claude plugin uninstall spinner-facts@spinner-facts   # remove it
```

## 开发

```sh
claude plugin validate .   # check the manifests and the hooks module
claude plugin test .       # run tests/spinner.test.tsx
python3 facts.py           # rebuild facts.txt from facts.md (run in this folder)
```

| Path | What it is |
| --- | --- |
| `.claude-plugin/plugin.json` | The plugin's manifest and its options |
| `.claude-plugin/marketplace.json` | Makes this folder (or its repository) installable with `--marketplace` |
| `hooks/register.ts` | The plugin: picks facts and rewrites the spinner word |
| `tests/spinner.test.tsx` | Tests: scrolling, turns, options, Unicode widths |
| `facts.md` | The facts as collected, with headings and sources |
| `facts.py` | Turns `facts.md` into `facts.txt`, dropping headings, quotes and lists |
| `facts.txt` | The bundled facts the plugin reads |
