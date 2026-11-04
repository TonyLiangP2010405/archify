# 架构图命名端口（Architecture named ports）设计

日期：2026-11-04
状态：待评审

## 背景与意图

现在的 Architecture 图里，一条线只能表达“从 A 这台机器到 B 这台机器”。端点落在卡片四条边中的某一条上，具体落在边上的哪个位置由渲染器自动排布（`automaticPortSpread` + `automaticEndpoint`）。作者能控制的只有 `fromSide` / `toSide`。

真实场景（WyreStorm 的 AV 接线图）需要的是：线接在机器上的**某一个具体接口**——HDMI IN 2、HDBaseT OUT、RJ45——并且那个接口在图上是一个看得见的“孔”，线头正好收在孔上。参考文件 `新加坡-金桥-SIT.drawio` 里，107 条线全部用 `exitX/exitY`、`entryX/entryY` 这种 0–1 相对坐标钉在 68 张设备图片的某个点上，这就是 drawio 的“打孔”。

因此本次改动的目标不是把 Archify 变成 drawio，而是让 Architecture 的 JSON IR 能表达“命名端口”，并让渲染器把它画出来、校验它、并且不破坏现有图。

## 目标

1. 组件可以声明一组命名端口，每个端口属于左或右一条边，按声明顺序排列。
2. 连线可以指名 `fromPort` / `toPort`；线头精确落在该端口的中心，路由从该边垂直出入。
3. 端口在卡片边缘画成一个小“孔”，端口名以小字排在卡片内侧。
4. 新的校验在写文件前拦住：端口不存在、同一端口被两条线占用、端口与 `fromSide` 冲突、那条边放不下这些端口。
5. 没有声明 `ports` 的图，输出字节不变。

## 非目标

- 不导入 drawio 文件，不支持设备照片。
- 不引入自由锚点（任意坐标）。端口必须是有名字的、声明过的。
- 不支持上/下边的端口（理由见“需要确认的取舍”第 1 条）。
- 不做端口类型/连接器形状（HDMI 梯形口、RJ45 方口等）；`label` 里写清楚即可。
- 不改 Viewer 的交互、图例、focus、passport、导出。
- 不改其余九种图。
- 不引入自动布局；端口位置仍然是确定性的槽位，不是布局引擎。

## 约束

- **JSON IR 是唯一事实来源**，schema 用 `additionalProperties: false`，新字段必须进 schema。
- **渲染器仍然手放坐标**：端口槽位由卡片尺寸和端口数量算出，不改变组件位置。
- **失败即拒绝**：端口结构问题（未知端口、重复插口、容量、rail 溢出、端口边排他）在 `validate` 阶段报 error，`standard` 与 `showcase` 一样拒绝写文件。
- **零依赖**：只用现有 shared 模块，不新增 npm 包。
- **单个 `<svg>`**：`check-render-output` 的 `single_svg` 必须继续通过。
- **产物可移植**：输出仍是单文件 HTML，端口信息只存在于 SVG 与交付回执里。
- **向后兼容**：现有 example 的渲染结果必须逐字节不变。

## 方案（已选 A）

- **A（选中）端口挂在组件上**：`components[].ports` + `connections[].fromPort/toPort`。端点仍是精确的点，渲染器画孔，校验覆盖端口语义。
- **B（否决）端口当独立小节点**：路由和校验白拿，但组件列表被插头污染，legend/lens/viewer 会把插头当机器。
- **C（否决为主方案）自由锚点**：`fromAt/toAt` 相对坐标，改动最小但没有可校验的端口，多个口挤在一起时名字读不出来。

## 设计

### 1. Schema

`archify/schemas/architecture.schema.json`：

```json
"components": {
  "items": {
    "properties": {
      "ports": {
        "type": "array",
        "maxItems": 16,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["id", "label", "side"],
          "properties": {
            "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]{0,31}$" },
            "label": { "type": "string", "minLength": 1, "maxLength": 20 },
            "side": { "enum": ["left", "right"] }
          }
        }
      }
    }
  }
}
```

```json
"connections": {
  "items": {
    "properties": {
      "fromPort": { "type": "string", "minLength": 1, "maxLength": 32 },
      "toPort":   { "type": "string", "minLength": 1, "maxLength": 32 }
    }
  }
}
```

要点：

- `ports` 可选。没有任何组件声明端口时，整个新路径不参与计算。
- 端口 `id` 只在所属组件内唯一；连线通过 `conn.from` / `conn.to` 定位组件后，再在它的端口表里解析 `fromPort` / `toPort`。
- 端口顺序 = 渲染顺序：左/右边从上到下按数组顺序。
- `side` 必填。不写 `side` 就不猜——猜错会让线头出现在机器的另一侧。
- 不存在 `ports[].kind`、`ports[].x/y`、`ports[].multi`。

示例：

```json
{
  "id": "matrix",
  "type": "backend",
  "label": "HDMI Matrix",
  "pos": [420, 200],
  "size": [240, 130],
  "ports": [
    { "id": "in-1", "label": "HDMI IN 1", "side": "left" },
    { "id": "in-2", "label": "HDMI IN 2", "side": "left" },
    { "id": "out-1", "label": "HDMI OUT 1", "side": "right" },
    { "id": "hdbaset-1", "label": "HDBT OUT", "side": "right" }
  ]
}
```

```json
{ "id": "src-pc-to-matrix", "from": "src-pc", "to": "matrix", "fromPort": "hdmi-out", "toPort": "in-1" }
```

### 2. 端口几何（新增 `archify/renderers/shared/port-layout.mjs`）

纯函数，渲染器、路由、校验共用同一个来源：

```js
portSlots(component) -> Map<portId, { side, point: [x, y] }>
portRails(component)  -> { left, right }   // 卡片内侧要给端口名留出的宽度
portCapacity(component) -> [{ side, count, requiredPx, availablePx, ok }]
```

规则：

- 端口所在的边分为两段：**装饰带**（顶部，让开 sigil 与 brand）与**端口带**。
  - 左/右边端口带：`top = 28`，`bottom = 16`，`usable = extent - 44`。
  - 28 的依据：sigil 在 `(x+6..x+17, y+6..y+17)`，brand 在 `(x+w-22..x+w-6, y+6..y+22)`；6px 端口名以孔心为基线时上下各 3px，孔心放到 `y+28` 时文字顶边 `y+25`，与 brand 的 `y+22` 留 3px。
  - 16 的依据：与 `portHasCornerClearance` 的既有底部内缩一致；tag 基线在 `y+h-8`，端口名在其上方 8px。
- 同一侧 k 个端口：k = 1 时居中于端口带；k ≥ 2 时**在端口带内等距铺满**，`spacing = usable / (k - 1)`。
  - 这与 `automaticPortSpread`（按对端排序、`min(14, usable/(k-1))`、整体居中）不同，是有意的：端口是设备面板，等距铺满才像面板；自动端点不是。
- `spacing < 14` 时不压缩、不叠放，直接报容量错误（见 4）。`requiredPx = 44 + 14 * (k - 1)`（k ≥ 1）。现有 fan-out 预算 `32 + 14 × (k − 1)` 描述的是自动端点，两者不混用。
- 位置只依赖卡片 `x/y/width/height` 与端口数组顺序，不依赖其他节点。
- 端口点位于卡片边框上：左侧 `x = c.x`，右侧 `x = c.x + c.width`。

端口名轨（rail）宽度：

- `rail = ceil(textUnits(label) * 4.8) + 10`，字体 8px，`data-detail="context"`——端口名是这张图的主信息，必须在默认阅读档位可见（6px 的 fine 档会被 Viewer 隐藏，实测截图确认过）。
- 卡片正文（label/sublabel/tag）居中于 `c.width - leftRail - rightRail` 的剩余带宽内。
- 两条边的 rail 之和超过卡片宽度的一半时，报 `architecture/port-rail-crowded`，并给出“加宽到 N px”或“缩短端口名”的修法。

### 3. 路由接入（`archify/renderers/architecture/routing.mjs`）

- 在 `createRouter` 初始化时预算一次 `fixedPorts = Map<componentId, Map<portId, {side, point}>>`。
- `connectionEndpointSide(conn, endpoint)`：若该端点有 `fromPort`/`toPort`，直接返回端口所在边，优先于 `fromSide` / `rowFanOutSides` / `defaultFromSide`。
- `connectionGeometry(conn)`：有端口的端点直接用端口点，不再走 `automaticEndpoint` 的避让搜索；`start/end` 与 `ports.from/to` 标记照旧。
- `automaticPortSpread` 仍然只接收**没有端口的连线**；端口连线的端点不参与“按对端坐标排序”的自动分槽。
- **有端口的边是排他的**：自动选边时，端口组件优先选没有端口的一侧；如果左、右两边都已声明端口而仍有自动连线，或作者显式 `fromSide` 指向端口所在的边，报 `architecture/port-side-exclusive`。这样同一条边上不会出现“命名孔 + 无名落点”两套秩序。
- `via` / `route` / `channelX/Y` / `labelAt` 的行为不变：端口只改起点/终点，不改路线约束。

### 4. 渲染（`archify/renderers/architecture/render-architecture.mjs`）

卡片结构新增一个包裹组，避免命中 `[data-node-id] > rect:not(.c-mask)` 的卡片描边样式：

```xml
<!-- 组件：pos [420,200]，size [240,130]；左端口 HDMI IN 1 位于孔心 y=228 -->
<g data-node-id="matrix" ...>
  <rect ... class="c-mask"/>
  <rect ... class="c-backend"/>          <!-- 卡片本体，样式不变 -->
  <g data-ports="">
    <rect class="c-port-jack" x="416" y="223" width="8" height="10" rx="1.5"/>
    <text data-detail="fine" x="428" y="231" font-size="6">HDMI IN 1</text>
    ...
  </g>
  <text data-node-label="" ...>HDMI Matrix</text>
</g>
```

- 孔：跨在边框上的小圆角矩形（约 8×10），`class="c-port-jack"`；填充走 `--mask`，描边走所属类型的 `--*-stroke`，颜色只用 CSS 变量，不写内联颜色。Blueprint 预设下改方角（沿用 `node-card-style` 的既有做法）。
- 端口名：6px，`data-detail="fine"`；左侧 `text-anchor="start"`、`x = c.x + 8`，右侧 `text-anchor="end"`、`x = c.x + c.width - 8`。
- 卡片正文按 2 的 rail 内缩后半宽居中，字号继续走 `fittedNodeFontSize`，可用宽度改为内缩后的宽度。
- 空口（声明了但没有线）照样画孔和名字：它就是面板的一部分。
- 线头不需要额外标记：`data-composition-points` 的第一个/最后一个点就是端口点，现有检查照常工作。

### 5. 校验

新增诊断。**全部是 error，`standard` 与 `showcase` 一视同仁**：这些是“图是否真实可选”的结构问题，不是审美打磨，和现有 `architecture/component-label-overflow`、`layout/component-overlap` 同级。渲染器直接 throw，走现有 `throwDiagnosticProblems` 通道；不改 `validate` 成功回执的结构。

| code | 触发 | supportedFixes |
|---|---|---|
| `architecture/unknown-port` | `fromPort`/`toPort` 在该组件端口表里不存在 | 改端口 id；列出该组件可用端口 |
| `architecture/duplicate-port-id` | 同一组件内两个端口同 id | 重命名其一 |
| `architecture/port-side-conflict` | 同时写了 `fromSide` 且与端口 `side` 不同 | 删掉 `fromSide`，或改端口所在边 |
| `architecture/port-duplicate-use` | 两条连线用同一个端口 | 改用另一个端口；一个孔只接一根线 |
| `architecture/port-capacity` | `spacing < 14` | 把卡片加高到 `requiredPx`；把端口分到另一侧；减少端口 |
| `architecture/port-rail-crowded` | 两条 rail + 正文最小宽度超过卡片宽度 | 加宽卡片到 N px；缩短端口名 |
| `architecture/port-side-exclusive` | 自动连线落到了有端口的边，或显式 `fromSide` 指向该边 | 给这条线也声明端口；或改用另一侧；或移到卡片另一侧 |
| `architecture/port-side-unsupported` | （schema 已挡）上/下边端口 | 移到 left/right |

不新增的规则：允许只写一端端口；允许端口空着；`label` 缺失由 schema 挡。

`check-render-output` 不改：孔是 `<rect>`、名字是 `data-detail="fine"`，既不进节点矩形收集，也不进可读性下限。

### 6. 文档与分发

- `archify/SKILL.md`：在 Architecture 的 authoring 段落加一段端口用法（什么时候该声明端口、什么时候用 `fromSide` 就够）。
- `archify/references/authoring-defaults.md`：补端口容量公式 `44 + 14 × (k − 1)`、装饰带 28/16、rail 预算、left/right 限制。
- `archify/references/authoring-contract.md`：几何规则表里加端口条目。
- `archify/schemas/README.md`：字段说明。
- `archify/examples/av-patch-panel.architecture.json` + `scripts/render-examples.mjs` 的 `TARGETS` 增加一条；渲染产物 `av-patch-panel-rendered.html` 进仓库。
- `archify/delta/architecture-delta.mjs`：`COMPONENT_FIELDS` 加 `ports`，`CONNECTION_FIELDS` 加 `fromPort` / `toPort`，按 `semantic` 归类（端口增加/改名/改接线属于语义变化；只移孔位不属于，因为孔位由尺寸算出）。新增一条 delta 测试。
- 重新生成 `archify/renderers/shared/generated-validators.mjs`（`npm run generate:validators`）。
- `archify.zip` / `skill-release.json` 不在本切片内更新：本次交付是“源码 + 本地安装”，不走发布通道；仓库的 zip 一致性检查会因此显红，这是已知且有意的取舍。

### 6.1 交付与回滚

1. 备份现装：把 `C:\Users\WS\.agents\skills\archify` 复制为 `archify.backup-<时间戳>`。
2. 用本切片里的 `archify/` 覆盖安装目录（保留目录名，不新增软链）。
3. 验证：`node <安装目录>/bin/archify.mjs doctor`，再用新示例跑一次 `finalize architecture ... --quality showcase --json`，确认端口图能交付。
4. 回滚：删掉覆盖后的目录，把备份目录改回 `archify`。

### 7. 测试

新增：

- `test/architecture-ports-schema.test.mjs`：端口字段被接受；未知字段被拒；上/下边被拒。
- `test/architecture-ports-geometry.test.mjs`：槽位等距且确定；线头正好落在 `[c.x, y]` / `[c.x+width, y]`；`fromSide` 冲突被拒；自动连线被排他规则挡下。
- `test/architecture-ports-capacity.test.mjs`：`requiredPx` 与诊断字段；rail 溢出诊断；`supportedFixes` 文案。
- `test/architecture-ports-render.test.mjs`：孔和端口名出现在 `<g data-ports>` 里；只有一个 `<svg>`；端口名在 `data-detail="fine"`；空口也画。
- `test/architecture-delta-ports.test.mjs`：只改端口名 → `semantic` 变化；只加端口不接线 → 仍出现在变化列表。

回归：

- `npm run test:generated`（viewer/brand/validators 的 fresh 检查 + `test/golden.mjs`），确认无端口图的字节不变。
- `node archify/scripts/render-examples.mjs` 后 `git diff --stat` 只应出现新增示例与 expected 改动。
- 新示例跑 `node archify/bin/archify.mjs finalize architecture ... --quality showcase --json`。

## 需要确认的取舍

1. **只支持 left/right**：上/下边的端口名在 14px 槽距下必然互相压字，需要竖排或错行，不在本切片。作者遇到时会得到明确诊断。
2. **一个孔只接一根线**：物理上正确，也让“重复插口”成为可查的错误。需要一对多时分两个端口。
3. **端口名 6px + rail**：与现有 `tag` 同档，不参与可读性下限；如果不想要 rail 内缩，可以改成“端口名只在 passport 里”，但那就回到了“名字不可读”。
4. **不引入 `ports[].kind`**：先让 label 承担连接器类型；等真的需要按类型着色/换形状时再加。
5. **schema_version 保持 1**：纯新增可选字段，旧文档继续有效；不写迁移。

## 风险

- 端口 rail 会实质改变卡片可用宽度，现有示例如果加端口就需要重排；因此**新示例独立**，不改旧示例。
- 端口边排他会把“同侧混排”从隐式行为变成显式错误：作者会被要求给这条线也声明端口、或换到另一侧。体验上更啰嗦，但不会出现孔与无名落点抢同一个边的情况；测试要覆盖三种修法各一条。
- 6px 端口名在缩放后可能难读；这是与 `tag` 相同的既有取舍，showcase 档不做额外下限。

## 留给实现者决定

- 孔的具体尺寸/圆角（建议 8×10、rx 1.5）与 CSS 类名。
- `portSlots` 的等距实现是否复用 `automaticPortSpread` 的内部常量，还是单独一份 14/16 常量。
- 是否顺手把端口名放进 node passport 的 `context` 字段（便宜，但不改变图形）。
- 新示例选哪台真实设备（建议 4×2 矩阵 + 2 台源 + 2 台显示）。
