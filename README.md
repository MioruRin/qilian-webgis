# 祁连山国家公园全过程监控系统 - WebGIS

## 快速开始

### 环境要求
- Windows 10/11
- Python 3.8+（安装时勾选 "Add Python to PATH"）
- 现代浏览器（Chrome/Edge/Firefox）

### 启动步骤

1. **双击 `启动服务.bat`**
   - 脚本会自动检查Python环境、安装依赖、启动服务
   - 浏览器会自动打开 http://localhost:5000

2. **如需外网访问**：双击 `外网共享.bat`
   - 会自动生成一个公网链接（如 https://xxx.trycloudflare.com）
   - 把链接发给别人即可在外网访问

### 手动启动（不用脚本）

```bash
cd backend
pip install flask flask-cors
python app.py
```
浏览器打开 http://localhost:5000

## 系统架构

```
qilian-webgis/
├── 启动服务.bat          ← 双击启动
├── 外网共享.bat          ← 双击生成公网链接
├── cloudflared.exe       ← 内网穿透工具（自动下载）
├── requirements.txt      ← Python依赖
├── backend/
│   ├── app.py            ← Flask后端（API服务）
│   └── data/
│       ├── qilian_webgis.db          ← SQLite数据库（8949条记录）
│       └── vectors/                  ← GeoJSON矢量数据
│           ├── qilian_boundary.geojson    ← 公园边界
│           ├── watersheds.geojson         ← 六大流域
│           ├── monitoring_stations.geojson ← 监测站点
│           ├── wildlife_stations.geojson   ← 野生动物相机点
│           ├── human_activities.geojson   ← 人类活动点
│           ├── endangered_plants.geojson   ← 濒危植物分布
│           ├── rivers.geojson              ← 河流网络
│           ├── ne_provinces.geojson        ← 行政区划
│           ├── ne_roads.geojson            ← 道路网络
│           └── ne_lakes.geojson            ← 湖泊
└── frontend/
    ├── index.html        ← 主页面
    ├── css/style.css     ← 暗色主题样式
    └── js/app.js         ← 七大功能模块逻辑
```

## 七大功能模块

| 模块 | 功能说明 |
|------|----------|
| 首页/一张图 | 卫星底图 + 公园边界/流域/河流/道路/省份矢量叠加 |
| 网格监控 | 高级检索 + 生态系统/人类活动/濒危动植物统计面板 |
| 生态环境 | 8个监测站点 + 气象时序图表 + 6项遥感指标 + InVEST模型 |
| 动植物 | 野生动物相机站点 + 濒危植物分布 + 气候情景模拟 |
| 人类活动 | 活动点位检索 + 4级分区统计 + 2013-2019趋势图 |
| 遥感监控 | NDVI专题可视化 + 时间轴动画 + 降水统计分析 |
| 数据库 | 山/水/林/田/湖/草/沙/冰八类专题图层管理 |

## 技术栈

- **前端**: Leaflet 1.9.4 + ECharts 5.4.3（CDN加载）
- **后端**: Flask + Flask-CORS
- **数据库**: SQLite（无需安装，开箱即用）
- **底图**: Esri World Imagery 卫星影像（在线）
- **穿透**: Cloudflare Tunnel（临时免费）

## 数据库说明

SQLite数据库 `backend/data/qilian_webgis.db` 包含 8949 条记录：

| 数据表 | 记录数 | 内容 |
|--------|--------|------|
| monitoring_stations | 8 | 大野口流域监测站 |
| meteorological_data | 8768 | 2020-2022逐日气象数据 |
| ecosystem_stats | 6 | 区域生态系统面积统计 |
| wildlife_observations | 100 | 野生动物观测记录 |
| endangered_plants | 19 | 濒危植物分布点 |
| ndvi_time_series | 10 | 2013-2022年NDVI数据 |
| precipitation_time_series | 95 | 2000-2018年降水量 |
| human_activity_trends | 28 | 2013-2019分区趋势 |
| remote_sensing_indicators | 48 | 6项遥感指标8年数据 |

## 常见问题

**Q: 启动后浏览器空白？**
A: 需要联网加载Leaflet/ECharts CDN和Esri卫星底图，请确保网络正常。

**Q: 公网链接打不开？**
A: Cloudflare临时隧道无SLA保证，可能偶尔断线，关闭后重新运行 `外网共享.bat` 即可。

**Q: 端口5000被占用？**
A: 修改 `backend/app.py` 最后一行的 `port=5000` 为其他端口。
