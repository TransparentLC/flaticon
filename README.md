# flaticon

一个**免登录**从 [Flaticon](https://www.flaticon.com/) 下载 SVG 格式图标的服务，同时提供用户脚本方便直接在 Flaticon 的页面上下载图标。

![](https://p.sda1.dev/29/b5b776ca30309a86594b2113dbceaea3/7Qjt.webp)

---

你也可以自己部署这个项目，将 `.env.example` 复制为 `.env` 按照说明进行一些设置即可。

由于 Flaticon 近日添加了风控，需要使用无头浏览器获得 Cookie，因此部署时需要安装 Firefox 和 [GeckoDriver](https://github.com/mozilla/geckodriver)。

```sh
pnpm install
pnpm run build
node --env-file=.env dist/index.js
```
