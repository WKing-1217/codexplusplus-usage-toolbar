# Codex++ 用量栏

查看 API 余额、套餐和当前任务 Token。

**[点击下载 Windows 安装包](https://github.com/WKing-1217/codexplusplus-usage-toolbar/releases/download/v1.0.8/codexplusplus-usage-toolbar-v1.0.8.zip)** · 当前版本 **1.0.8**

需要先安装 Codex++，并配置好 API 供应商。官方账号直接登录时不显示此用量栏。

## 第一次安装

1. 点击上面的下载链接。下载完成后，右键压缩包 → **全部解压**。
2. 打开解压后的文件夹，双击 **install.cmd**，等待提示安装成功。
3. 保存当前工作，在 Codex++ 管理工具中点击 **重启 Codex++**。

打开一个本机任务，点击顶部用量栏，即可查看余额和 Token。详情底部显示 **1.0.8** 就是新版。

## 已经安装，怎样更新？

1. 在 Windows 开始菜单中搜索 **Codex++ 用量栏更新**，点击运行。
2. 等待更新成功，保存当前工作，再点击 **重启 Codex++**。

也可以双击文件夹里的 **update.cmd**。不用删除旧文件，也不用重复下载安装包。

## 遇到问题

| 情况 | 怎么做 |
| --- | --- |
| 找不到更新入口 | 下载上面的安装包，解压后双击 **install.cmd**，直接覆盖升级。 |
| 余额查询失败 | 先点 **立即刷新**；仍失败时双击 **repair.cmd**，完成后再刷新。 |
| Token 没显示 | 打开具体的本机 API 任务，点 **刷新 Token**。 |
| 还是无法使用 | 双击 **diagnose.cmd**，附上生成的诊断报告和报错截图，在 [这里反馈](https://github.com/WKing-1217/codexplusplus-usage-toolbar/issues)。 |

要恢复上一版，双击 **rollback.cmd**；要卸载，双击 **uninstall.cmd**。

## 支持范围

Windows；Codex++ **1.2.56**；Codex **26.831.20005 / 26.901.20858**；Sub2API / New API。

这是 Codex++ 用户脚本扩展。运行环境由安装器自动准备。

[更新记录](CHANGELOG.md) · [详细说明](docs/REFERENCE.md) · [验证记录](VALIDATION.md)
