# 架构图面板节点（Architecture faceplate nodes）设计

日期：2026-11-04
状态：待评审
前置：`2026-11-04-architecture-port-anchors-design.md`（命名端口，已实现）

## 背景与意图

命名端口已经能表达“线接在哪个口”，但端口只能落在卡片左右两边。WyreStorm 的接线库（`D:\wyrestorm-draw\WyreStorm-port-library`）给出了另一种现实：一台设备是一块**面板**（1401×237 这样的横条），插口分布在面板里的两排，位置由归一化坐标给出（258 个面、2512 个点）。

要“把机器打孔”就得让孔出现在图上的真实位置，而不是被压到卡片边缘。参考物仍是 drawio：每个面是一张图 + 若干可吸附热点；线端吸附到热点上。Archify 要做的是同一件事，只是把“热点”变成可校验、可路由、可导出的一等字段。

同时有一个硬约束：**这套产品库不能进公开仓库**。所以本设计把能力与数据分开：

- 公共仓库只增加通用能力：一个“面板节点”，以及它需要的 schema、渲染、路由、校验、文档。
- 设备库是本地私有目录，由不进仓库的脚本从现有 JSON/图片生成；图上引用的图片路径也指向该目录。

## 目标

1. 一个组件可以是一块面板：图片 + 一组带归一化坐标的孔。
2. 线头落在孔上：孔在面板内部，渲染器从孔画一小段引线到最近的边，正式路由从那个边点出发。
3. 面板节点的型号名可读（面板图下方一条窄标题带），端口名通过悬停/无障碍文本可得。
4. 缺图、坐标越界、尺寸比例不符、端口重复等问题在写文件前报错。
5. 没有 `faceplate` 的图输出字节不变。
6. 私有设备库可以按型号取出一段可直接粘进图的 component 片段。

## 非目标

- 不做运行时读取 drawio 库；导入是一次性的离线转换。
- 不做设备浏览 UI、拖拽画布、图片编辑。
- 不做“一个节点显示多个面”；一个节点一个面，面由作者选。
- 不自动识别图片里的插口（坐标来自库，不来自图像识别）。
- 不改其他九种图；不改 Viewer 交互、图例、导出格式。
- 公共仓库不包含任何 WyreStorm 图片、型号清单或坐标数据。

## 约束

- JSON IR 是唯一事实来源；`additionalProperties: false`。
- 单文件可移植产物：面板图在渲染时内联为 data URI，HTML 自包含。
- 零运行时依赖；图片处理只用 Node 内置（读取 + base64）。
- 面板节点仍遵守“手放坐标”：作者给 `pos`/`size`，渲染器不重排。
- 失败即拒绝：结构问题在 `standard` 与 `showcase` 都是 error。
- 无 `faceplate` 的文档逐字节不变。

## 方案

**A（选中）面板节点 + 私有库**：`components[].faceplate`，渲染器画图、画引线，路由只认边点；私有库是一个文件夹，Agent 直接读取型号片段。公共面最小。

**B（否决）A + 公开 `archify devices` 命令**：多一套公开的库格式与 CLI。对上游有价值，但要额外定义格式、发现规则、测试与文档；当前只有一份私有库，属于提前抽象。

**C（否决）全部私有**：能力只打在已安装的 skill 里。与“代码公开”的决定冲突，而且以后无法用标准方式分发。

## 设计

### 1. Schema

```json
"components": [{
  "id": "tx-1",
  "type": "backend",
  "label": "SW-660-TX-W",
  "pos": [420, 200],
  "size": [420, 85],
  "faceplate": {
    "image": { "path": "faces/SW-660-TX-W-088.png", "sha256": "…64 hex…" },
    "width": 1401,
    "height": 237,
    "ports": [
      { "id": "hdmi-in-1", "label": "HDMI IN 1", "x": 0.328, "y": 0.79 },
      { "id": "hdbaset-out", "label": "HDBASET OUT", "x": 0.61, "y": 0.79, "side": "bottom" }
    ]
  }
}]
```

- `image.path`：相对**作者输入的 JSON 所在目录**的路径，或绝对路径。`validate`/`deliver`/`finalize` 会把规范快照到临时目录再渲染，所以 CLI 必须把作者路径通过 `ARCHIFY_INPUT_PATH` 传给渲染器，渲染器按它解析相对路径（缺省回落到 `process.cwd()`）。`preview` 只监听 JSON，图片变动不会触发重渲——记录为已知限制。
- `image.sha256`：图片文件的 SHA-256。渲染前校验，防止同尺寸换图导致“同一份 JSON 产出不同图”。
- `width` / `height`：图片固有像素，用于算比例；必须与文件实际尺寸一致，否则报错（防止图被换掉而坐标失配）。
- `ports[].x/y`：相对图片区域的 0–1 坐标（左上为 0,0）。
- `ports[].label`：面板丝印上的名字；图里不重复排版，用于悬停、无障碍文本与回执。
- `ports[].side`：可选，`left|right|top|bottom`；不写则由像素距离取最近的边。
- `size`：节点框，**就是图片区**（比例必须等于 `height/width`，容差 0.5px）；不符时报错并给出应有高度。
- 同一个组件不能同时声明 `ports` 与 `faceplate`；`faceplate` 节点也不接受 `sublabel`、`tag`、`icon`、`brand`（图片已承载外观），`label` 必填。
- `faceplate` 节点必须用 `pos` + `size`；`layout.mode: grid` 与面板节点互斥（网格单元尺寸无法满足比例锁定）。

### 2. 节点与标题

- 节点框 = 图片区，图片铺满整框（比例由校验保证）。
- 型号名画在**节点外侧下方**（drawio 的做法）：8px、居中、`data-detail="context"`，距节点下缘 4px。作者要把面板节点的下方留出至少 14px 空地；这一点写进 authoring defaults。
  - 不放在框内，是因为框内的任何一条横带都会让“端点在框边上”这条不变量失效：图片的边才是节点边，引线和路由才能保持垂直、可校验。
- 节点边框保留 1px 类型色描边（聚焦/悬停样式依赖它），图片在其内侧。
- 面板多为黑底白丝印：深色主题下自然融合；浅色主题下按原图显示，不加滤镜、不反色。

### 3. 孔与引线

- 每个孔画一个 4px 圆点（填充 `--mask`、描边类型色、透明度 0.55），带 `<title>`（端口名）。图里不排端口名。
- 引线：从孔心到**最近边**的垂足，1px、类型色、透明度 0.55，不参与路由。
  - 边由像素距离决定：左边距 `x·W`、右边距 `(1−x)·W`、上边距 `y·H`、下边距 `(1−y)·H`；显式 `side` 优先。
  - 因为节点框就是图片区，垂足必然落在节点边框上；`side` 即该边，路由器按现有“端点必须在边上、垂直出入”的规则工作，不需要放宽。
- 两个孔落在同一条边的同一点时（重叠坐标），视为错误，报重复端点。

### 4. 路由与校验

- 渲染器把 `faceplate.ports` 换算成 `fixedPorts: { side, point }`，与命名端口走同一条固定端点路径。
- **端口命名空间**：面板孔参与 `unknown-port` 与“一个孔一根线”的检查（同 id 的 port 引用要么落在 `ports`，要么落在 `faceplate.ports`），但**不参与** `port-side-exclusive`——面板边天然排满插口，普通连线仍可进入；自动端点会把面板孔当作已占用位置避开（不报错）。
- 图片哈希不匹配 => `architecture/faceplate-image-changed`。
- 新诊断：
  - `architecture/faceplate-missing-image`：文件不存在/不可读。
  - `architecture/faceplate-image-mismatch`：声明尺寸与文件实际尺寸不一致。
  - `architecture/faceplate-aspect`：`size` 与图片比例（含标题带）不符，给出应有尺寸。
  - `architecture/faceplate-port-bounds`：`x/y` 越出 0–1。
  - `architecture/faceplate-port-duplicate`：端口 id 重复，或两个孔映射到同一边点。
  - `architecture/faceplate-and-ports`：同时声明 `ports` 与 `faceplate`。
  - `architecture/faceplate-image-changed`：`sha256` 与文件不符。
  - `architecture/faceplate-image-format`：不是 PNG/JPEG（不接受 SVG，SVG 没有可靠固有尺寸）。
  - `architecture/faceplate-layout-conflict`：与 `grid` 布局或 `ports` 同时使用，或带有被禁止的字段。
  - `architecture/faceplate-image-heavy`：单图 > 400KB 时 warning（不是 error），提示产物会变大。
- 不让 `check-render-output` 新增规则：图片是 `<image>`，圆点/引线是普通图元；标题带文本是 context，计入现有可读性。

### 5. 私有设备库（不进仓库）

位置建议：`D:\wyrestorm-draw\archify-devices\`

```
index.json                 # 型号 → 面 → 孔数 / 图片 / 尺寸
models/<SKU>.json          # 每个面一段可直接粘进图的 component 片段
faces/<face-id>.png        # 从接口面复制/裁剪的原图（不含“孔位核对”叠图）
build.mjs                  # 生成脚本（只在本地）
```

- `build.mjs` 读 `接线端口清单.json`（UTF-8）+ `接口面/<id>.png`，输出上述结构；`size` 按宽度 420 计算，标题带 14px。
- 面选择：`index.json` 标出每个型号的默认面（孔数最多者）；`models/<SKU>.json` 给全部面，作者可按面取用。
- 片段里的 `image` 用相对路径 `faces/...`，因此把 `archify-devices` 整个目录搬走仍然可用。
- 该目录不受 Archify 版本影响；升级 skill 不会动它。

### 6. 文档与测试

- `SKILL.md` 一段：什么时候用面板节点；图片与坐标的来历；不要手抄坐标。
- `references/authoring-defaults.md`：面板尺寸公式、标题带、边推导、与 `ports` 互斥。
- `references/authoring-contract.md`：几何规则补“面板节点”一条。
- `schemas/README.md`：`faceplate` 字段。
- 公共示例：`archify/examples/patch-panel.architecture.json` + `archify/examples/assets/patch-panel.png`（脚本生成的 640×120 合成接口条，无品牌），验证图片、引线、边推导与连线。示例附带生成该 PNG 的说明，保证可复现。
- `archify/delta/architecture-delta.mjs`：`faceplate` 归入 semantic（图片、哈希、端口坐标都是接线语义）。
- 测试：
  - schema：字段接受/拒绝、与 `ports` 互斥。
  - 几何：边推导（近上/下/左/右各一例）、垂足坐标精确、显式 `side` 生效。
  - 渲染：`<image>` 存在且是 data URI、圆点数量、标题带文本、单个 `<svg>`。
  - 校验：缺图、尺寸不符、比例不符、越界、重复端点、同时声明。
  - 兼容：无 `faceplate` 的文档字节不变（golden）。

## 需要确认的取舍

1. **标题带放在框内（图片区 + 14px）**，而不是 drawio 那样放在图下方外部：避免文字与走线相撞，代价是节点比图片高 14px。
2. **不在图上重复端口名**：丝印已有名字；重复排版会和图片里的文字打架。端口名只在悬停/无障碍/回执里。
3. **图片内联进 HTML**：产物自包含、可导出；代价是每个面板 50–200KB，十个设备约 1–2MB。
4. **一个节点一个面**：接线图通常只用后接口面；前面板面留给立面图，以后需要再谈。
5. **边由像素距离推导**：横条面板上绝大多数口从下边出，符合机柜实际；个别侧口可以显式 `side`。
6. **标题在框外**：框内放标题带会破坏“端点在边上”的不变量（builder check 指出），所以型号名画在节点下方，作者负责留空。
7. **图片哈希固定**：同尺寸换图会让“同一 JSON 两份产物”，与 brand marks 的做法一致，必须固定。
8. **面板孔不触发端口边排他**：面板边天然排满，普通连线仍可进入，自动端点避开孔位即可。
9. **只接受 PNG/JPEG**：SVG 没有可靠固有尺寸，示例与测试都用 PNG。

## 风险

- 面板图是黑底白丝印，浅色主题下会是一块深色区域；这是产品图本身，不做反色（反色会让丝印不可读）。
- 高清面板图（1401px 宽）缩到 420px 后，丝印文字约 3–4px，不可读。真实使用的可读性依赖放大；这是“图 + 孔”模式的固有限制，不承诺丝印可读。
- 私有库的坐标与图片必须同源；`build.mjs` 与库文件要一起备份，否则片段会指向旧图。

## 留给实现者决定

- 圆点与引线的具体尺寸/透明度；是否在 hover 时加粗（若加，属于 Viewer 改动，需单独评估）。
- 图片解码只校验 PNG/JPEG 头还是完整解析（建议只读头部尺寸，避免引入解码库）。
- 标题带字体是否随节点宽度收缩（建议沿用 `fittedNodeFontSize`）。
- 合成示例图用 PNG 还是 SVG data URI（建议 SVG，纯文本、可审阅）。
