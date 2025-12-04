# ssnpmproxy
## 应用场景
NPM供应链攻击可以成功实施的原因是：

包管理工具在更新NPM包时，总是会选用满足依赖约束条件的**最新版NPM**包，并且该行为还不支持更改

只要不使用最新版NPM包，就能避开大多数供应链攻击，因为安全社区也会监测NPM仓库内的恶意NPM包，并上报给NPM仓库删除，恶意NPM包的存活时间是短的

该命令可以强制 npm, yarn, pnpm(待支持中..) 等包管理器使用次新版NPM包

## 工作流程
1. 获取该包的最新版发布天数，若发布天数大于15天（可配置），则信任它
2. 若小于15天，则降级最新版包到已发布15天以上的次新版包

# 使用教程
## 初始化
在NodeJS项目的根目录下执行如下命令，而后会在根目录生成 npmproxy.json 配置文件
```
npx ssnpmproxy init
```

配置文件中，需要注意的只有 daysThreshold 字段，它表达信任发布多少天以上的NPM包
```json
{
    "port": 40798,
    "sslPath": "/var/folders/rs/w_d4vmzd1j30zdr_tyxjsvqw0000gn/T/npmproxy-c0f16174b4fe05c3",
    "daysThreshold": 15
}
```

## 安装 / 更新包
使用 npm, yarn, pnpm 安装 / 更新NPM包时，在前面添加 npx ssnpmproxy 前缀，如下示例
```
npx ssnpmproxy yarn add ...
npx ssnpmproxy npm add ...
npx ssnpmproxy yarn upgrade
```

如下是一个使用示例，在启用npmproxy安装zustand时，它对发布在15天内的包进行了降级，例如将zustand降级到5.0.8
```
npx ssnpmproxy npm i zustand
starting server for registry.npmjs.org
https server started for registry.npmjs.org on 64057
⠇Downgrading zustand from 5.0.9 to 5.0.8
⠋Downgrading @types/react from 19.2.7 to 19.2.6
⠋Downgrading immer from 11.0.1 to 10.2.0

added 1 package, and audited 33 packages in 10s
```