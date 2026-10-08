# 自动更新维护说明

## 2026-10-08 重新核查结果

- `main` 仍为 `7f0c7d53855a3907a169acc36725b660855d7f6b`，提交时间为 2026-08-17 01:04:18 UTC；核查时没有打开的 PR。
- 最新返回的运行仍是 [32698978186](https://github.com/genaqin-spec/ai-news-aggregator/actions/runs/32698978186)，2026-08-24 06:50:46 UTC。初始化日志明确拒绝非 `genaqin-spec` 所有的 Actions。
- [32684848164](https://github.com/genaqin-spec/ai-news-aggregator/actions/runs/32684848164) 的抓取成功，随后 `data/archive.json` 为 101.39 MB，推送被拒绝。
- 当前归档为 104,698,963 字节、208,929 条。原逻辑以 `last_seen_at` 清理，反复出现在榜单中的旧资讯不断续期，且没有容量上限；翻译缓存也没有淘汰机制。
- 仓库元数据返回写入权限。工作流启用状态、Actions 管理设置的读取接口不可用，不能确认当前设置，也不能确认 8 月 24 日之后没有新运行的完整原因。

GitHub 的常规 Git 单文件拒绝阈值是 **100 MiB**，即 104,857,600 字节；50 MiB 以上会警告。本修复把生成文件预算放在该阈值之下。[官方说明](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)

## 数据保留策略

保留现有 JSON 路径和 `items` 数组格式，前端无需迁移；无需 Git LFS、新数据库或付费服务。

| 数据 | 保留规则 | 数量上限 | UTF-8 JSON 大小上限 |
| --- | --- | ---: | ---: |
| `archive.json` | 默认 45 天；按可信发布时间，否则按首次发现时间 | 40,000 条 | 20 MiB |
| `latest-24h.json`、`latest-7d.json` | 各自时间窗口；优先保留较新资讯 | 各 40,000 条 | 各 20 MiB |
| `title-zh-cache.json` | 只保留已持久化归档仍引用的标题，优先较新资讯 | 20,000 条 | 4 MiB |
| 单个生成 JSON 写入及提交 | 最后一道防线 | — | 50 MiB |

实现位于 `src/storage/retention.ts`。保留天数是上限，不承诺高流量下保存完整的 45 天历史；容量预算先达到时淘汰较旧条目。快照从本次抓取合并后的有效数据独立生成，不因历史归档容量淘汰而先丢失当前窗口资讯。快照达到自身预算时也会淘汰尾部条目，保留计数和来源统计与实际 `items` 一致；原始抓取计数仍表示限制前数量。

- `last_seen_at` 仍用于记录观测，但不决定过期或容量淘汰顺序。
- 缺失/非法发布时间回退到有效 `first_seen_at`，未来发布时间也回退；两者都不可信则清理。快照排除未来事件时间。
- 没有发布时间且已被淘汰的记录，后续重新抓到时只能视为重新发现；没有永久保存的历史 ID，无法推断其真实发布日期。
- 按紧凑 JSON 的实际字节计量，包含中文、emoji、转义字符和元数据。单条异常巨大记录会被跳过，其他新资讯继续处理。
- 兼容旧版 `items` 对象和现有数组；损坏的整个 JSON 会报错，避免静默覆盖原数据。
- 原子写入临时文件后重命名；最终大小检查在覆盖前执行。
- `source-status.json.storage` 记录过期、容量淘汰、缓存清理和字节数。容量截断不会伪装成完整归档。

首次成功抓取会自动迁移/清理旧归档和缓存。本 PR 不提交巨大的历史数据差异，也不直接更改生产快照。以 2026-10-08 为清理时钟时，8 月 17 日存留的全部归档都已超过 45 天；运行抓取后由新资讯补充。不要在恢复抓取前单独写入空归档来冒充已恢复更新。

## 工作流行为

仍按 UTC `0 */2 * * *` 每 2 小时运行（北京时间每个偶数整点，GitHub 可能延迟），提供手动入口。只在默认分支发布，防止从修复分支手动运行时改动生产。

1. 使用 Node 22、固定 pnpm 7.33.7，保持现有锁文件格式；补充已有 `xml2js` 依赖缺失的类型声明包。
2. 执行类型检查和存储回归测试，再抓取、生成 OPML JSON、构建站点。
3. 使用与官方 Pages 上传工具一致的 `artifact.tar` 格式，直接调用固定 SHA 的官方 `upload-artifact`，避免 `upload-pages-artifact@v3` 内部的未固定 `upload-artifact@v4` 依赖。
4. 在上传成功后提交公开生成数据。提交步骤失败时记录 Actions warning 和 Step Summary，后续 Pages 部署仍执行。持久化失败并不代表归档/缓存保存成功，下一次会重新读取仓库旧数据。
5. 只提交明确的七个公开 JSON 文件，包含新建文件；不提交原始 OPML 文件或无关代码。推送不使用 force 或 rebase，遇到并发修改会报错，保留远端更改。

权限分到各 job：测试只读，更新 job 仅 `contents: write` / `pages: write`，部署 job 才有 `pages: write` / `id-token: write`。新增 `Storage regression tests` 工作流供 PR 和合并后回归使用，不抓取外网或访问 OPML secret。

## 必须由仓库管理员检查/修改的设置

代码不能覆盖仓库级的 Action 白名单。打开 [Settings → Actions → General](https://github.com/genaqin-spec/ai-news-aggregator/settings/actions)：

1. 在 **Actions permissions** 中选择 **Allow genaqin-spec, and select non-genaqin-spec, actions and reusable workflows**。
2. 在指定 Action 列表中精确允许以下五条，并保存。不需要开放所有 Actions，也不需要启用全部 Marketplace 认证作者。

```text
actions/checkout@11d5960a326750d5838078e36cf38b85af677262
actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
actions/configure-pages@1f0c5cde4bc74cd7e1254d0cb4de8d49e9068c7d
actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e
```

这些 SHA 在修复时通过各官方仓库对应 `v4` 标签实时解析。所有直接和间接 Action 依赖都固定后，可启用 **Require actions to be pinned to a full-length commit SHA**；以后升级 SHA 要同步维护白名单。[官方设置说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)

3. **Workflow permissions** 的仓库默认值可保持只读：本工作流按 job 显式申请写权限。不要为了此次修复全局开放写权限，也不需要勾选 “Allow GitHub Actions to create and approve pull requests”。旧运行日志已显示 `Contents: write`；若出现实际 403，再检查更上层策略。
4. 在 [Settings → Pages](https://github.com/genaqin-spec/ai-news-aggregator/settings/pages) 确认 Source 为 **GitHub Actions**；检查 `github-pages` 环境允许默认分支部署。若原设置正确无需修改。
5. 在 [Actions 工作流页](https://github.com/genaqin-spec/ai-news-aggregator/actions/workflows/update-ai-news.yml) 检查是否有 **Enable workflow** 按钮；若有则启用。若账号或仓库被 GitHub 禁用，按界面提示联系支持；代码无法解除该状态。
6. 合并修复后从 **main** 手动 **Run workflow**，确认更新、数据提交、部署三部分都成功，再确认出现新的 `schedule` 运行。仅手动成功不能证明定时触发恢复。

公开仓库无活动 60 天会自动停用定时工作流，fork 的定时工作流默认禁用；本仓库曾有成功定时运行，且最近提交距核查日约 52 天，不能据此认定 8 月 24 日立即停跑是 60 天规则导致。[启用工作流说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)

若默认分支保护/ruleset 拒绝 Actions bot 直接提交，需要按现有仓库治理规则允许该自动数据写入，或另行改成数据分支/数据 PR 模式；不要关闭全部分支保护。此项仅在实际推送被拒绝时处理，当前没有验证到此类故障。

## 本地验证与维护命令

```bash
npm install --global pnpm@7.33.7
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build

# 只预览清理结果，不写数据，不访问资讯源
pnpm data:compact --now 2026-10-08T10:27:56Z

# 按旧快照时间验证容量迁移效果，不写数据
pnpm data:compact --now 2026-08-17T01:03:44.181Z

# 确需持久化维护结果时才使用 --write（会删除过期/超容量数据）
pnpm data:compact --write

# 实际抓取会访问资讯/翻译接口，自动执行相同保留策略
pnpm fetch
pnpm exec tsx src/generate-opml-json.ts

cd web
pnpm install --frozen-lockfile
GITHUB_PAGES=true pnpm build
```

如果运行环境不允许 `tsx` CLI 创建本地 IPC socket，可使用 `node --import tsx src/compact-data.ts ...` / `node --import tsx src/index.ts ...`，不需改变业务代码。

## 已验证与待验证

**已验证：** 16 项测试在 Node 22.23.3 和 Node 24.19.0 上通过，涵盖不可续期的过期规则、时间边界、缺失/未来日期、旧格式迁移、条数限制、UTF-8 精确预算、单条超大记录、缓存淘汰、原子写入、两次模拟抓取、未跟踪文件提交、超限提交拦截及远端并发更改保护；根项目类型检查/编译和前端生产构建通过。两个工作流通过 YAML 解析和 Action SHA 完整性检查，提交脚本通过 Bash 语法检查。

对真实 208,929 条归档执行只读预演：按原快照 2026-08-17 的时钟保留 40,000 条，紧凑归档为 **16,853,592 字节**；过期 2,070 条，容量淘汰 166,859 条，缓存为 204,503 字节。按 2026-10-08 时钟，全部旧归档过期。预演没有修改实际 `data/`。

另外，在临时目录对真实归档副本执行两次实际写入迁移，验证文件字节上限和相同时钟下的幂等性；生产 `data/` 保持原样。

**待验证：** GitHub 当前管理设置、工作流启用状态、真实资讯源/翻译服务的当前可用性、Actions runner 完整运行、Pages 线上部署以及后续自动 `schedule` 触发。模拟抓取测试不代表外网服务可用。

本次限制的是新生成文件大小，不能回收既有 Git 历史；高频提交仍会积累仓库历史。若需要永久完整历史，应存到对象存储等外部归档，不宜持续扩大 Git JSON。历史瘦身需要单独规划和备份，涉及改写历史；本修复不改写现有历史。
