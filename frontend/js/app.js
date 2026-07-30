/* =====================================================================
 * 祁连山国家公园全过程监控系统 - 前端主程序
 * 依赖: Leaflet 1.9.4, ECharts 5.4.3
 * 后端: Flask @ http://localhost:5000
 * ===================================================================== */
(function () {
'use strict';

/* ============================ 配置 ============================ */
const API = window.location.origin + '/api';
const MAP_CENTER = [38.5, 100.5];
const MAP_ZOOM = 8;
const ESRI_IMG = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABEL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

const COLORS = {
    accent: '#00b4d8', accent2: '#0077b6', success: '#06d6a0',
    warning: '#ffd166', danger: '#ef476f', pink: '#ff5d8f',
    purple: '#b388ff', orange: '#ff9f43', green: '#4caf50'
};
// 生态系统配色
const ECO_COLORS = {
    glacier: '#90caf9', grassland: '#a5d6a7', bare_land: '#bcaaa4', shrub: '#81c784',
    desert: '#ffe082', human_activity: '#ef9a9a', forest: '#66bb6a', wetland: '#4dd0e1',
    water_body: '#64b5f6'
};
const ECO_META = {
    glacier_km2: { name: '冰川', color: ECO_COLORS.glacier },
    grassland_km2: { name: '草地', color: ECO_COLORS.grassland },
    bare_land_km2: { name: '裸地', color: ECO_COLORS.bare_land },
    shrub_km2: { name: '灌丛', color: ECO_COLORS.shrub },
    desert_km2: { name: '荒漠', color: ECO_COLORS.desert },
    human_activity_km2: { name: '人类活动', color: ECO_COLORS.human_activity },
    forest_km2: { name: '森林', color: ECO_COLORS.forest },
    wetland_km2: { name: '湿地', color: ECO_COLORS.wetland },
    water_body_km2: { name: '水体', color: ECO_COLORS.water_body }
};

/* ============================ 工具函数 ============================ */
const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));

async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`请求失败 [${res.status}]: ${txt.slice(0, 120)}`);
    }
    return res.json();
}
function fmt(n, d = 2) {
    if (n === null || n === undefined || isNaN(n)) return '--';
    return Number(n).toFixed(d);
}
function fmtCoord(lng, lat) {
    return `${fmt(lng, 4)}°E, ${fmt(lat, 4)}°N`;
}
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============================ 全局状态 ============================ */
const State = {
    map: null,
    baseImagery: null,
    baseLabel: null,
    layers: {},          // layerName -> L.GeoJSON/L.LayerGroup
    layerVisible: {},    // layerName -> bool
    module: 'home',
    charts: {},          // chartId -> ECharts instance
    cachedStations: null,
    cachedHuman: null,
    cachedWildlife: null,
    cachedPlants: null,
    timelineTimer: null,
    ndviData: null,
    precipChartType: 'bar',
    currentRSIndicator: 'NDVI',
    wildlifeSpecies: '',
    plantSimTime: 'current',
    plantEnabled: { '国家二级保护': true, '特有植物': true, '珍贵药材': true },
    currentPlant: null
};

/* ============================ 地图初始化 ============================ */
function initMap() {
    State.map = L.map('map', {
        center: MAP_CENTER,
        zoom: MAP_ZOOM,
        zoomControl: false,
        attributionControl: true,
        preferCanvas: true
    });

    State.baseImagery = L.tileLayer(ESRI_IMG, {
        attribution: 'Esri World Imagery', maxZoom: 18
    }).addTo(State.map);
    State.baseLabel = L.tileLayer(ESRI_LABEL, {
        maxZoom: 18, opacity: 0.8
    }).addTo(State.map);

    // 坐标 / 缩放 / 比例尺 跟踪
    State.map.on('mousemove', e => {
        $('#coordDisplay').textContent = fmtCoord(e.latlng.lng, e.latlng.lat);
    });
    State.map.on('zoomend moveend', updateScale);

    // 默认比例尺控件(隐藏式，仅用于取值)
    updateScale();
}

function updateScale() {
    const z = State.map.getZoom();
    $('#zoomDisplay').textContent = z;
    // 估算比例尺
    const meters = State.map.distance(
        State.map.containerPointToLatLng([0, 0]),
        State.map.containerPointToLatLng([100, 0])
    );
    const scale = Math.round(meters * 10); // 100px ~ scale
    $('#scaleDisplay').textContent = '1:' + (scale >= 1000 ? (scale / 1000).toFixed(1) + '万' : scale);
}

/* ============================ 图层加载与管理 ============================ */
const LAYER_DEFS = {
    boundary:    { label: '国家公园边界', style: () => ({ color: COLORS.danger, weight: 2.5, opacity: .9, fill: false }) },
    watersheds:  { label: '流域分区',     style: () => ({ color: COLORS.pink, weight: 1.5, opacity: .8, fillColor: COLORS.pink, fillOpacity: .06 }) },
    rivers:      { label: '河流水系',     style: () => ({ color: '#4dd0e1', weight: 2, opacity: .9 }) },
    provinces:   { label: '省级行政区',   style: () => ({ color: '#5a6b78', weight: 1, opacity: .6, fillColor: '#2b3e52', fillOpacity: .15, dashArray: '4,3' }) },
    roads:       { label: '道路',         style: () => ({ color: '#ffd166', weight: 1.2, opacity: .7 }) },
    lakes:       { label: '湖泊',         style: () => ({ color: '#4dd0e1', weight: 1, fillColor: '#4dd0e1', fillOpacity: .4 }) },
    stations:    { label: '监测站点',     point: true, type: 'station' },
    wildlife:    { label: '野生动物站点', point: true, type: 'wildlife' },
    human_activities: { label: '人类活动点', point: true, type: 'human' },
    plants:      { label: '濒危植物点',   point: true, type: 'plant' }
};

async function loadLayer(name) {
    if (State.layers[name]) return State.layers[name];
    try {
        const data = await fetchJSON(`${API}/geojson/${name}`);
        const def = LAYER_DEFS[name];
        let layer;
        if (def && def.point) {
            layer = L.layerGroup();
            const markers = makePointLayer(data, def.type);
            markers.forEach(m => m.addTo(layer));
            layer._mkArr = markers;
        } else {
            layer = L.geoJSON(data, {
                style: def ? def.style : () => ({ color: COLORS.accent, weight: 1.5 }),
                onEachFeature: (feat, lyr) => {
                    const p = feat.properties || {};
                    lyr.bindPopup(makeVectorPopup(name, p));
                }
            });
        }
        State.layers[name] = layer;
        return layer;
    } catch (e) {
        console.warn('加载图层失败', name, e);
        return null;
    }
}

function makePointLayer(geojson, type) {
    const arr = [];
    L.geoJSON(geojson, {
        pointToLayer: (feat, latlng) => {
            const p = feat.properties || {};
            let marker, icon;
            if (type === 'station') {
                icon = L.divIcon({ className: '', html: '<div class="mk-station mk-pulse" style="width:14px;height:14px"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
                marker = L.marker(latlng, { icon });
                marker.bindPopup(makeStationPopup(feat));
            } else if (type === 'wildlife') {
                icon = L.divIcon({ className: '', html: '<div class="mk-cam" style="width:12px;height:12px"></div>', iconSize: [12, 12], iconAnchor: [6, 6] });
                marker = L.marker(latlng, { icon });
                marker.bindPopup(makeWildlifePopup(feat));
            } else if (type === 'plant') {
                icon = L.divIcon({ className: '', html: '<div class="mk-plant" style="width:12px;height:12px"></div>', iconSize: [12, 12], iconAnchor: [6, 6] });
                marker = L.marker(latlng, { icon });
                marker.bindPopup(makePlantPopup(feat));
            } else { // human
                icon = L.divIcon({ className: '', html: '<div class="mk-human"></div>', iconSize: [8, 8], iconAnchor: [4, 4] });
                marker = L.marker(latlng, { icon });
                marker.bindPopup(makeHumanPopup(feat));
            }
            marker._feat = feat;
            arr.push(marker);
            return marker;
        }
    });
    return arr;
}

async function ensureLayer(name) {
    const l = await loadLayer(name);
    if (l && !State.map.hasLayer(l)) l.addTo(State.map);
    State.layerVisible[name] = true;
    return l;
}
function hideLayer(name) {
    const l = State.layers[name];
    if (l && State.map.hasLayer(l)) State.map.removeLayer(l);
    State.layerVisible[name] = false;
}
function clearAllOverlays() {
    Object.keys(State.layers).forEach(hideLayer);
}

/* ============================ 弹窗模板 ============================ */
function photoThumb(label) {
    return `<div class="pop-thumb"><svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg><span>${label || '照片占位'}</span></div>`;
}
function makeStationPopup(feat) {
    const p = feat.properties || {};
    const c = feat.geometry.coordinates;
    return `<div class="pop-card">
        <div class="pop-head">${esc(p.name || '监测站点')}</div>
        ${photoThumb('站点照片')}
        <div class="pop-body">
            <div class="pr"><span class="k">站点编号</span><span class="v">${esc(p.id || '--')}</span></div>
            <div class="pr"><span class="k">经纬度</span><span class="v">${fmt(c[0],4)}°E, ${fmt(c[1],4)}°N</span></div>
            <div class="pr"><span class="k">海拔</span><span class="v">${p.elevation || '--'} m</span></div>
            <div class="pr"><span class="k">林分类型</span><span class="v">${esc(p.type || '--')}</span></div>
        </div></div>`;
}
function makeWildlifePopup(feat) {
    const p = feat.properties || {};
    return `<div class="pop-card">
        <div class="pop-head">${esc(p.name || '监测站点')}</div>
        ${photoThumb('红外相机')}
        <div class="pop-body">
            <div class="pr"><span class="k">站点名称</span><span class="v">${esc(p.name)}</span></div>
            <div class="pr"><span class="k">物种</span><span class="v">${esc(p.species || '--')}</span></div>
            <div class="pr"><span class="k">温度</span><span class="v">${fmt(p.temperature,1)} ℃</span></div>
        </div></div>`;
}
function makePlantPopup(feat) {
    const p = feat.properties || {};
    return `<div class="pop-card">
        <div class="pop-head">${esc(p.name || '濒危植物')}</div>
        ${photoThumb('植物照片')}
        <div class="pop-body">
            <div class="pr"><span class="k">植物名称</span><span class="v">${esc(p.name)}</span></div>
            <div class="pr"><span class="k">学名</span><span class="v"><i>${esc(p.sci_name || '--')}</i></span></div>
            <div class="pr"><span class="k">类型</span><span class="v">${esc(p.protection || '--')}</span></div>
            <div class="pr"><span class="k">海拔</span><span class="v">${p.elevation || '--'} m</span></div>
        </div></div>`;
}
function makeHumanPopup(feat) {
    const p = feat.properties || {};
    const c = feat.geometry.coordinates;
    return `<div class="pop-card">
        <div class="pop-head">${esc(p.name || '人类活动点')}</div>
        <div class="pop-body">
            <div class="pr"><span class="k">名称</span><span class="v">${esc(p.name)}</span></div>
            <div class="pr"><span class="k">类型</span><span class="v">${esc(p.type || '--')}</span></div>
            <div class="pr"><span class="k">所属分区</span><span class="v">${esc(p.zone || '--')}</span></div>
            <div class="pr"><span class="k">经纬度</span><span class="v">${fmt(c[0],4)}°E, ${fmt(c[1],4)}°N</span></div>
        </div></div>`;
}
function makeVectorPopup(name, p) {
    const title = LAYER_DEFS[name] ? LAYER_DEFS[name].label : name;
    const rows = Object.entries(p).slice(0, 6).map(([k, v]) =>
        `<div class="pr"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('');
    return `<div class="pop-card"><div class="pop-head">${esc(title)}</div><div class="pop-body">${rows}</div></div>`;
}

/* ============================ 图例 ============================ */
function setLegend(rows) {
    const body = $('#legendBody');
    body.innerHTML = rows.map(r => `<div class="lg-row"><span class="lg-sym">${r.sym}</span><span class="lg-label">${esc(r.label)}</span></div>`).join('');
}
const LEGEND_HOME = [
    { sym: '<svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#ef476f" stroke-width="2.5"/></svg>', label: '国家公园边界' },
    { sym: '<svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#ff5d8f" stroke-width="1.5"/></svg>', label: '流域分区' },
    { sym: '<svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#4dd0e1" stroke-width="2"/></svg>', label: '河流水系' },
    { sym: '<svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#ffd166" stroke-width="1.2"/></svg>', label: '道路' },
    { sym: '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#ef476f;border:2px solid #fff"></span>', label: '监测站点' },
    { sym: '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#06d6a0;border:2px solid #fff"></span>', label: '野生动物站点' },
    { sym: '<span style="display:inline-block;width:10px;height:10px;background:#b388ff;border:2px solid #fff;transform:rotate(45deg)"></span>', label: '濒危植物' },
    { sym: '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef476f;border:1px solid #fff"></span>', label: '人类活动点' }
];

/* ============================ ECharts 暗色主题工具 ============================ */
const CHART_TXT = '#e8edf2', CHART_AXIS = '#5a6b78', CHART_SPLIT = '#2a3a4a';
function chartBase(gridExtra) {
    return {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: '#1a2733', borderColor: '#00b4d8', textStyle: { color: CHART_TXT } },
        grid: Object.assign({ left: 45, right: 18, top: 30, bottom: 28, containLabel: true }, gridExtra || {}),
        textStyle: { color: CHART_TXT, fontFamily: 'Microsoft YaHei' }
    };
}
function axisStyle() {
    return {
        axisLine: { lineStyle: { color: CHART_AXIS } },
        axisLabel: { color: CHART_AXIS, fontSize: 10 },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: CHART_SPLIT, type: 'dashed' } }
    };
}
function getChart(id) {
    if (State.charts[id]) return State.charts[id];
    const el = document.getElementById(id);
    if (!el) return null;
    State.charts[id] = echarts.init(el, null, { renderer: 'canvas' });
    return State.charts[id];
}
function resizeAllCharts() {
    Object.values(State.charts).forEach(c => { try { c.resize(); } catch (e) {} });
}

/* ============================ 模块切换 ============================ */
const MODULE_TITLES = {
    home: '一张图 · 祁连山国家公园',
    grid: '网格监控 · 生态环境综合监管',
    eco: '生态环境 · 森林生态水文监控',
    wildlife: '动植物监控 · 野生动物动态监测',
    plants: '动植物监控 · 濒危植物监测',
    human: '人类活动监控 · 建设用地监管',
    remote: '遥感监控 · 生态要素遥感监测',
    database: '数据库 · 专题图层资源概览'
};

function switchModule(mod) {
    State.module = mod;
    // 顶部导航
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.module === mod));
    // 左右侧栏面板
    $$('.module-panel').forEach(p => p.classList.remove('active'));
    $$(`.module-panel[data-panel="${mod}"]`).forEach(p => p.classList.add('active'));
    // 地图标题
    $('#mapOverlayTitle').textContent = MODULE_TITLES[mod] || '';
    // 时间轴默认隐藏
    $('#timelineBar').classList.remove('show');
    stopTimeline();

    // 触发模块逻辑
    setTimeout(() => {
        State.map.invalidateSize();
        resizeAllCharts();
        runModule(mod);
    }, 60);
}

function runModule(mod) {
    switch (mod) {
        case 'home': modHome(); break;
        case 'grid': modGrid(); break;
        case 'eco': modEco(); break;
        case 'wildlife': modWildlife(); break;
        case 'plants': modPlants(); break;
        case 'human': modHuman(); break;
        case 'remote': modRemote(); break;
        case 'database': modDatabase(); break;
    }
}

/* =====================================================================
   MODULE 1 - 首页 / 一张图
   ===================================================================== */
async function modHome() {
    setLegend(LEGEND_HOME);
    clearAllOverlays();
    // 默认显示边界、流域、河流、道路、省份
    await Promise.all([
        ensureLayer('boundary'), ensureLayer('watersheds'),
        ensureLayer('rivers'), ensureLayer('roads'), ensureLayer('provinces'),
        ensureLayer('lakes')
    ]);
    State.map.setView(MAP_CENTER, MAP_ZOOM);
    buildHomeLayerControl();
}

function buildHomeLayerControl() {
    const wrap = $('#homeLayerControl');
    const order = ['boundary', 'watersheds', 'rivers', 'lakes', 'roads', 'provinces', 'stations', 'wildlife', 'plants', 'human_activities'];
    wrap.innerHTML = order.map(name => {
        const def = LAYER_DEFS[name];
        const vis = !!State.layerVisible[name];
        return `<div class="ck-row"><input type="checkbox" data-layer="${name}" ${vis ? 'checked' : ''}><span>${def.label}</span></div>`;
    }).join('');
    $$('#homeLayerControl input').forEach(cb => {
        cb.addEventListener('change', async () => {
            const name = cb.dataset.layer;
            if (cb.checked) await ensureLayer(name);
            else hideLayer(name);
        });
    });
}

/* =====================================================================
   MODULE 2 - 网格监控
   ===================================================================== */
async function modGrid() {
    setLegend([
        { sym: '<svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#ef476f" stroke-width="2.5"/></svg>', label: '国家公园边界' },
        { sym: '<svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#ff5d8f" stroke-width="1.5"/></svg>', label: '流域分区' },
        { sym: '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef476f;border:1px solid #fff"></span>', label: '人类活动点' }
    ]);
    clearAllOverlays();
    await Promise.all([ensureLayer('boundary'), ensureLayer('watersheds'), ensureLayer('human_activities')]);
    State.map.setView(MAP_CENTER, MAP_ZOOM);

    // 加载右侧数据
    loadGridStats();
    // 默认检索结果(站点)
    doGridSearch();
}

async function loadGridStats() {
    // 生态系统统计
    try {
        const eco = await fetchJSON(`${API}/ecosystem-stats?region=${encodeURIComponent('黑河流域')}`);
        renderGridEco(eco);
    } catch (e) { $('#gridEcoPanel').innerHTML = `<div class="muted center">生态系统数据加载失败</div>`; }
    // 人类活动统计
    try {
        const ha = await fetchJSON(`${API}/human-activity-stats?region=${encodeURIComponent('祁连山全域')}`);
        renderGridHuman(ha);
    } catch (e) { $('#gridHumanPanel').innerHTML = `<div class="muted center">人类活动数据加载失败</div>`; }
    // 野生动物物种
    try {
        const wl = await fetchJSON(`${API}/wildlife/species`);
        renderGridWildlife(wl);
    } catch (e) { $('#gridWildlifePanel').innerHTML = `<div class="muted center">物种数据加载失败</div>`; }
}

function renderGridEco(eco) {
    const areas = eco.areas || [];
    const total = areas.reduce((s, a) => s + (a.area_km2 || 0), 0);
    let html = `<div class="flex-between mb8"><span class="muted" style="font-size:11px">区域</span><span class="tag-pill">${esc(eco.region)}</span></div>`;
    html += `<div class="ha-total" style="background:rgba(0,180,216,.08);border-color:rgba(0,180,216,.25);margin-bottom:8px;"><span class="v" style="color:${COLORS.accent}">${fmt(total,1)}</span><span class="l">km² 生态系统总面积</span></div>`;
    html += areas.map(a => {
        const meta = ECO_META[a.type] || { name: a.type, color: COLORS.accent };
        return `<div class="eco-row"><span class="eco-dot" style="background:${meta.color}"></span><span class="eco-name">${meta.name}</span><span class="eco-val">${fmt(a.area_km2,1)} km²</span><span class="eco-toggle"><input type="checkbox" checked></span></div>`;
    }).join('');
    $('#gridEcoPanel').innerHTML = html;
}

function renderGridHuman(ha) {
    const s = ha.stats || {};
    let html = `<div class="ha-stat">`;
    html += `<div class="ha-total"><span class="v">${fmt(s.total_km2,2)}</span><span class="l">km² 建设用地总面积</span></div>`;
    html += `<div class="ha-sub">
        <div class="cell"><div class="cv">${s.urban_land_count || 0}</div><div class="cl">城镇用地</div></div>
        <div class="cell"><div class="cv">${s.rural_residential_count || 0}</div><div class="cl">农村居民地</div></div>
        <div class="cell"><div class="cv">${s.reservoir_pond_count || 0}</div><div class="cl">水库坑塘</div></div>
        <div class="cell"><div class="cv">${s.industrial_mining_count || 0}</div><div class="cl">工矿用地</div></div>
    </div>`;
    html += `<div class="cell" style="margin-top:6px;"><div class="cv">${s.other_construction_count || 0}</div><div class="cl">其他建设用地</div></div>`;
    html += `</div>`;
    $('#gridHumanPanel').innerHTML = html;
}

function renderGridWildlife(wl) {
    const sum = wl.summary || [];
    let html = `<div class="wl-summary">`;
    sum.forEach(c => {
        html += `<div class="wl-cat"><span class="wl-name">${esc(c.category)}</span><span class="wl-meta">${c.order_count}目 <b>${c.family_count}</b>科 <b>${c.species_count}</b>种</span></div>`;
    });
    html += `<div class="wl-cat"><span class="wl-name">合计</span><span class="wl-meta"><b>${wl.total_species || 0}</b> 种</span></div>`;
    html += `</div>`;
    // 植物保护等级
    html += `<div class="section-title" style="margin-top:8px;">濒危植物保护等级</div>`;
    html += `<div class="check-list" id="gridPlantLevel"></div>`;
    $('#gridWildlifePanel').innerHTML = html;
    // 加载植物
    fetchJSON(`${API}/plants`).then(d => {
        const groups = d.groups || [];
        $('#gridPlantLevel').innerHTML = groups.map(g =>
            `<div class="ck-row"><input type="checkbox" checked><span>${esc(g.protection_level)}</span><span class="ck-count">${g.count} 种</span></div>`).join('');
    }).catch(() => {});
}

async function doGridSearch() {
    const list = $('#gridResultList');
    list.innerHTML = `<div class="muted center" style="padding:14px;">检索中...</div>`;
    try {
        if (!State.cachedStations) {
            State.cachedStations = await fetchJSON(`${API}/stations`);
        }
        const stations = State.cachedStations.stations || [];
        const results = stations.map((s, i) => ({
            id: s.id, name: s.name, meta: `${fmt(s.longitude,3)}, ${fmt(s.latitude,3)} · ${s.elevation || '--'}m`, data: s
        }));
        $('#gridResultCount').textContent = `共 ${results.length} 条`;
        list.innerHTML = results.map((r, i) =>
            `<div class="result-item" data-idx="${i}"><span class="rid">${i + 1}</span><div class="rinfo"><div class="rname">${esc(r.name)}</div><div class="rmeta">${r.meta}</div></div></div>`).join('');
        $$('#gridResultList .result-item').forEach(el => {
            el.addEventListener('click', () => {
                const r = results[+el.dataset.idx];
                State.map.setView([r.data.latitude, r.data.longitude], 12);
                ensureLayer('stations').then(() => {
                    const mk = State.layers.stations._mkArr.find(m => m._feat.properties.id === r.id);
                    if (mk) mk.openPopup();
                });
            });
        });
    } catch (e) {
        list.innerHTML = `<div class="muted center" style="padding:14px;">检索失败</div>`;
    }
}

/* =====================================================================
   MODULE 3 - 生态环境
   ===================================================================== */
async function modEco() {
    setLegend([
        { sym: '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#ef476f;border:2px solid #fff"></span>', label: '森林水文监测站' },
        { sym: '<svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#ef476f" stroke-width="2.5"/></svg>', label: '国家公园边界' }
    ]);
    clearAllOverlays();
    await Promise.all([ensureLayer('boundary'), ensureLayer('stations'), ensureLayer('rivers')]);
    // 聚焦大野口流域
    State.map.setView([38.53, 100.29], 11);

    // 加载站点列表
    loadEcoStations();
    // 默认查询气象
    queryMeteo();
}

async function loadEcoStations() {
    try {
        if (!State.cachedStations) State.cachedStations = await fetchJSON(`${API}/stations`);
        const stations = State.cachedStations.stations || [];
        // 填充站点下拉
        const sel = $('#meteoStation');
        sel.innerHTML = stations.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
        // 列表
        const list = $('#ecoStationList');
        list.innerHTML = stations.map((s, i) =>
            `<div class="result-item" data-id="${esc(s.id)}"><span class="rid">${i + 1}</span><div class="rinfo"><div class="rname">${esc(s.name)}</div><div class="rmeta">${fmt(s.longitude,3)}, ${fmt(s.latitude,3)} · ${s.elevation || '--'}m</div></div></div>`).join('');
        $$('#ecoStationList .result-item').forEach(el => {
            el.addEventListener('click', () => {
                const st = stations.find(s => s.id === el.dataset.id);
                if (st) {
                    State.map.setView([st.latitude, st.longitude], 13);
                    sel.value = st.id;
                    const mk = State.layers.stations._mkArr.find(m => m._feat.properties.id === st.id);
                    if (mk) mk.openPopup();
                }
            });
        });
    } catch (e) { $('#ecoStationList').innerHTML = `<div class="muted center">站点加载失败</div>`; }
}

async function queryMeteo() {
    const stationId = $('#meteoStation').value || 'DYK001';
    const metric = $('#meteoMetric').value || 'air_temp';
    const start = $('#meteoStart').value || '2020-01-01';
    const end = $('#meteoEnd').value || '2022-12-31';
    const chart = getChart('meteoChart');
    if (!chart) return;
    chart.showLoading({ text: '加载中...', color: COLORS.accent, textColor: COLORS.accent, maskColor: 'rgba(15,25,35,0.7)' });
    try {
        const d = await fetchJSON(`${API}/meteorological?station_id=${encodeURIComponent(stationId)}&start_date=${start}&end_date=${end}`);
        const dates = d.dates || [];
        const metricNames = {
            air_temp: '气温(℃)', soil_temp: '土壤温度(℃)', canopy_temp: '冠层温度(℃)',
            atmosphere_temp: '大气温度(℃)', precipitation: '降水量(mm)', humidity: '湿度(%)', wind_speed: '风速(m/s)'
        };
        // 采样: 数据量大时按月采样
        let xData = dates, series = [];
        const raw = (d.metrics || {})[metric] || [];
        if (dates.length > 400) {
            const step = Math.ceil(dates.length / 200);
            xData = dates.filter((_, i) => i % step === 0);
            series = xData.map(d => raw[dates.indexOf(d)]);
        } else {
            series = raw;
        }
        const color = COLORS.accent;
        chart.setOption({
            backgroundColor: 'transparent',
            tooltip: { trigger: 'axis', backgroundColor: '#1a2733', borderColor: COLORS.accent, textStyle: { color: CHART_TXT } },
            legend: { show: false },
            grid: { left: 45, right: 18, top: 30, bottom: 28, containLabel: true },
            xAxis: Object.assign({ type: 'category', data: xData, boundaryGap: false }, axisStyle()),
            yAxis: Object.assign({ type: 'value', name: metricNames[metric] || metric, nameTextStyle: { color: CHART_AXIS, fontSize: 10 } }, axisStyle()),
            series: [{
                name: metricNames[metric] || metric, type: 'line', data: series, smooth: true, symbol: 'none',
                lineStyle: { color: color, width: 1.6 },
                itemStyle: { color: color },
                areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(0,180,216,0.35)' }, { offset: 1, color: 'rgba(0,180,216,0)' }]) }
            }]
        }, true);
    } catch (e) {
        chart.setOption({ backgroundColor: 'transparent', title: { text: '暂无气象数据', left: 'center', top: 'center', textStyle: { color: CHART_AXIS, fontSize: 13 } } }, true);
    } finally {
        chart.hideLoading();
    }
}

/* =====================================================================
   MODULE 4 - 野生动物监控
   ===================================================================== */
async function modWildlife() {
    setLegend([
        { sym: '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#06d6a0;border:2px solid #fff"></span>', label: '红外相机站点' },
        { sym: '<svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#ef476f" stroke-width="2.5"/></svg>', label: '国家公园边界' }
    ]);
    clearAllOverlays();
    await Promise.all([ensureLayer('boundary'), ensureLayer('wildlife')]);
    State.map.setView(MAP_CENTER, 8);

    loadWildlifeSummary();
    loadWildlifeObs('');
}

async function loadWildlifeSummary() {
    try {
        const d = await fetchJSON(`${API}/wildlife/species`);
        const sum = d.summary || [];
        let html = sum.map(c =>
            `<div class="wl-cat"><span class="wl-name">${esc(c.category)}</span><span class="wl-meta">${c.order_count}目 <b>${c.family_count}</b>科 <b>${c.species_count}</b>种</span></div>`).join('');
        html += `<div class="wl-cat"><span class="wl-name">物种总数</span><span class="wl-meta"><b>${d.total_species || 0}</b> 种</span></div>`;
        $('#wildlifeSummary').innerHTML = html;
    } catch (e) { $('#wildlifeSummary').innerHTML = `<div class="muted center">数据加载失败</div>`; }
}

async function loadWildlifeObs(species) {
    const list = $('#wildlifeObsList');
    list.innerHTML = `<div class="muted center" style="padding:12px;">加载中...</div>`;
    try {
        const url = species ? `${API}/wildlife/observations?species=${encodeURIComponent(species)}` : `${API}/wildlife/observations`;
        const d = await fetchJSON(url);
        const obs = d.observations || [];
        if (!obs.length) { list.innerHTML = `<div class="muted center" style="padding:12px;">暂无监测记录</div>`; return; }
        list.innerHTML = obs.slice(0, 50).map((o, i) =>
            `<div class="result-item" data-id="${o.id}"><span class="rid">${i + 1}</span><div class="rinfo"><div class="rname">${esc(o.species)} · ${esc(o.media_type || '记录')}</div><div class="rmeta">${esc(o.observation_date)} · ${esc(o.station_id)}</div></div><span class="tag-pill">${esc(o.media_type)}</span></div>`).join('');
        // 更新右侧视频/照片信息(取第一条)
        updateWildlifeMedia(obs);
        $$('#wildlifeObsList .result-item').forEach(el => {
            el.addEventListener('click', () => {
                const o = obs.find(x => x.id == el.dataset.id);
                if (o) {
                    updateWildlifeMedia([o]);
                    // 定位到站点
                    const mk = State.layers.wildlife._mkArr.find(m => m._feat.properties.id === o.station_id);
                    if (mk) { State.map.setView(mk.getLatLng(), 11); mk.openPopup(); }
                }
            });
        });
    } catch (e) { list.innerHTML = `<div class="muted center" style="padding:12px;">加载失败</div>`; }
}

function updateWildlifeMedia(obs) {
    const video = obs.find(o => o.media_type === 'video') || obs[0];
    const photo = obs.find(o => o.media_type === 'photo') || obs[0];
    if (video) {
        $('#wvTime').textContent = video.observation_date || '--';
        $('#wvStation').textContent = video.station_id || '--';
        $('#wvSpecies').textContent = video.species || '--';
    }
    if (photo) {
        $('#wpTime').textContent = photo.observation_date || '--';
        $('#wpStation').textContent = photo.station_id || '--';
        $('#wpTemp').textContent = (photo.temperature != null ? fmt(photo.temperature, 1) + ' ℃' : '--');
    }
}

/* =====================================================================
   MODULE 4b - 濒危植物监控
   ===================================================================== */
async function modPlants() {
    setLegend([
        { sym: '<span style="display:inline-block;width:10px;height:10px;background:#b388ff;border:2px solid #fff;transform:rotate(45deg)"></span>', label: '濒危植物分布点' },
        { sym: '<svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#ef476f" stroke-width="2.5"/></svg>', label: '国家公园边界' }
    ]);
    clearAllOverlays();
    await Promise.all([ensureLayer('boundary'), ensureLayer('plants')]);
    State.map.setView(MAP_CENTER, 8);

    loadPlantData();
}

async function loadPlantData() {
    try {
        const d = await fetchJSON(`${API}/plants`);
        State.cachedPlants = d;
        // 统计
        const groups = d.groups || [];
        let html = groups.map(g =>
            `<div class="wl-cat"><span class="wl-name">${esc(g.protection_level)}</span><span class="wl-meta"><b>${g.count}</b> 种</span></div>`).join('');
        html += `<div class="wl-cat"><span class="wl-name">植物记录总数</span><span class="wl-meta"><b>${d.total || 0}</b> 条</span></div>`;
        $('#plantSummary').innerHTML = html;
        // 左侧勾选
        const cl = $('#plantCheckList');
        cl.innerHTML = groups.map(g => {
            const checked = State.plantEnabled[g.protection_level] !== false;
            return `<div class="ck-row"><input type="checkbox" data-level="${esc(g.protection_level)}" ${checked ? 'checked' : ''}><span>${esc(g.protection_level)}</span><span class="ck-count">${g.count} 种</span></div>`;
        }).join('');
        $$('#plantCheckList input').forEach(cb => {
            cb.addEventListener('change', () => {
                State.plantEnabled[cb.dataset.level] = cb.checked;
                filterPlantMarkers();
            });
        });
        // 植物列表
        renderPlantList(d);
        filterPlantMarkers();
    } catch (e) {
        $('#plantSummary').innerHTML = `<div class="muted center">植物数据加载失败</div>`;
    }
}

function renderPlantList(d) {
    const plants = d.plants || [];
    const list = $('#plantList');
    list.innerHTML = plants.slice(0, 60).map((p, i) =>
        `<div class="result-item" data-id="${p.id}"><span class="rid">${i + 1}</span><div class="rinfo"><div class="rname">${esc(p.name)}</div><div class="rmeta"><i>${esc(p.sci_name)}</i> · ${p.elevation || '--'}m</div></div><span class="tag-pill">${esc(p.protection_level)}</span></div>`).join('');
    $$('#plantList .result-item').forEach(el => {
        el.addEventListener('click', () => {
            const p = plants.find(x => x.id == el.dataset.id);
            if (p) {
                State.map.setView([p.latitude, p.longitude], 12);
                const mk = State.layers.plants._mkArr.find(m => {
                    const f = m._feat.properties; return f.name === p.name && Math.abs(f.elevation - p.elevation) < 1;
                });
                if (mk) mk.openPopup();
            }
        });
    });
}

function filterPlantMarkers() {
    const layer = State.layers.plants;
    if (!layer || !layer._mkArr) return;
    layer._mkArr.forEach(m => {
        const lvl = m._feat.properties.protection;
        const enabled = State.plantEnabled[lvl] !== false;
        if (enabled && !State.map.hasLayer(m)) m.addTo(State.map);
        if (!enabled && State.map.hasLayer(m)) State.map.removeLayer(m);
    });
}

function runPlantSim() {
    const type = $('#plantSimType').value;
    const temp = parseFloat($('#plantSimTemp').value) || 2.5;
    const precip = parseFloat($('#plantSimPrecip').value) || 1.2;
    const time = State.plantSimTime;
    const chart = getChart('plantSimChart');
    if (!chart) return;
    // 模拟: 基于当前分布点数, 气候因子影响适宜区
    const years = time === 'current' ? [2020] : (time === '2050' ? [2020, 2030, 2040, 2050] : [2020, 2030, 2040, 2050, 2060, 2070]);
    const baseCount = (State.cachedPlants && State.cachedPlants.plants || []).filter(p => p.name === type).length || 10;
    const factor = time === 'current' ? 1 : (time === '2050' ? (1 - temp * 0.08) : (1 - temp * 0.15));
    const series = years.map((y, i) => {
        const decay = time === 'current' ? baseCount : baseCount * Math.max(0.2, factor - i * 0.05 * precip);
        return Math.round(decay);
    });
    const desc = time === 'current' ? `当前气候情景下「${type}」适宜分布区` :
        (time === '2050' ? `2050年气候情景(升温${temp}℃)下适宜分布区收缩${Math.round((1 - factor) * 100)}%` :
            `2070年气候情景(升温${temp}℃)下适宜分布区收缩${Math.round((1 - factor) * 100)}%`);
    $('#plantSimDesc').textContent = desc;
    chart.setOption(Object.assign(chartBase(), {
        xAxis: Object.assign({ type: 'category', data: years.map(String) }, axisStyle()),
        yAxis: Object.assign({ type: 'value', name: '适宜区数量', nameTextStyle: { color: CHART_AXIS, fontSize: 10 } }, axisStyle()),
        series: [{
            name: '适宜分布区', type: 'bar', data: series, barWidth: '45%',
            itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: COLORS.purple }, { offset: 1, color: '#7c4dff' }]), borderRadius: [4, 4, 0, 0] }
        }]
    }), true);
}

/* =====================================================================
   MODULE 5 - 人类活动
   ===================================================================== */
async function modHuman() {
    setLegend([
        { sym: '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef476f;border:1px solid #fff"></span>', label: '人类活动点' },
        { sym: '<svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#ef476f" stroke-width="2.5"/></svg>', label: '国家公园边界' }
    ]);
    clearAllOverlays();
    await Promise.all([ensureLayer('boundary'), ensureLayer('human_activities')]);
    State.map.setView(MAP_CENTER, 8);

    doHumanSearch();
    loadHumanTrends();
}

async function doHumanSearch() {
    const list = $('#humanResultList');
    list.innerHTML = `<div class="muted center" style="padding:14px;">加载中...</div>`;
    try {
        if (!State.cachedHuman) {
            const d = await fetchJSON(`${API}/geojson/human_activities`);
            State.cachedHuman = d.features || [];
        }
        let feats = State.cachedHuman;
        const cat = $('#hSearch2').value;
        const name = $('#hSearch3').value.trim();
        if (cat) feats = feats.filter(f => f.properties.type === cat);
        if (name) feats = feats.filter(f => (f.properties.name || '').includes(name));
        $('#humanResultCount').textContent = `共 ${feats.length} 条`;
        if (!feats.length) { list.innerHTML = `<div class="muted center" style="padding:14px;">无匹配结果</div>`; return; }
        list.innerHTML = feats.slice(0, 200).map((f, i) => {
            const p = f.properties; const c = f.geometry.coordinates;
            return `<div class="result-item" data-idx="${i}"><span class="rid">${i + 1}</span><div class="rinfo"><div class="rname">${esc(p.name)}</div><div class="rmeta">${esc(p.type)} · ${esc(p.zone)} · ${fmt(c[0],3)},${fmt(c[1],3)}</div></div><button class="rbtn" data-idx="${i}">趋势分析</button></div>`;
        }).join('');
        $$('#humanResultList .result-item').forEach(el => {
            el.addEventListener('click', e => {
                if (e.target.classList.contains('rbtn')) return;
                const f = feats[+el.dataset.idx];
                State.map.setView([f.geometry.coordinates[1], f.geometry.coordinates[0]], 13);
                const mk = State.layers.human_activities._mkArr[State.cachedHuman.indexOf(f)];
                if (mk) mk.openPopup();
            });
        });
        $$('#humanResultList .rbtn').forEach(b => {
            b.addEventListener('click', e => {
                e.stopPropagation();
                loadHumanTrends();
                $('#humanTrendChart').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
        });
    } catch (e) { list.innerHTML = `<div class="muted center">加载失败</div>`; }
}

async function loadHumanTrends() {
    const chart = getChart('humanTrendChart');
    if (!chart) return;
    try {
        const d = await fetchJSON(`${API}/human-activity-trends`);
        const years = d.years || [];
        const zones = d.zones || [];
        const series = d.series || {};
        const palette = [COLORS.danger, COLORS.warning, COLORS.accent, COLORS.purple];
        chart.setOption(Object.assign(chartBase(), {
            legend: { top: 0, right: 10, textStyle: { color: CHART_AXIS, fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
            xAxis: Object.assign({ type: 'category', data: years.map(String), boundaryGap: false }, axisStyle()),
            yAxis: Object.assign({ type: 'value', name: '活动点数', nameTextStyle: { color: CHART_AXIS, fontSize: 10 } }, axisStyle()),
            series: zones.map((z, i) => ({
                name: z, type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
                data: series[z] || [],
                lineStyle: { color: palette[i % palette.length], width: 2 },
                itemStyle: { color: palette[i % palette.length] }
            }))
        }), true);
        // 分区统计
        renderHumanZone(zones, series, years);
    } catch (e) {
        chart.setOption({ backgroundColor: 'transparent', title: { text: '趋势数据加载失败', left: 'center', top: 'center', textStyle: { color: CHART_AXIS, fontSize: 13 } } }, true);
    }
}

function renderHumanZone(zones, series, years) {
    // 统计各分区总数(最后一年)
    const lastYear = years[years.length - 1];
    const vals = zones.map(z => ({ name: z, val: (series[z] || []).slice(-1)[0] || 0 }));
    const max = Math.max(...vals.map(v => v.val), 1);
    let html = `<div class="zone-stat">`;
    html += vals.map(v => `<div class="zone-bar"><span class="zb-name">${esc(v.name)}</span><div class="zb-track"><div class="zb-fill" style="width:${(v.val / max * 100).toFixed(0)}%"></div></div><span class="zb-val">${v.val}</span></div>`).join('');
    html += `</div>`;
    html += `<div class="muted center" style="font-size:11px;">${lastYear}年各分区人类活动点统计</div>`;
    $('#humanZonePanel').innerHTML = html;
}

/* =====================================================================
   MODULE 6 - 遥感监控
   ===================================================================== */
const RS_INDICATOR_NAMES = { NDVI: 'NDVI 植被指数', FVC: '植被覆盖度', NPP: '净初级生产力', BIOMASS: '草地生物量', FOREST: '森林蓄积量' };

async function modRemote() {
    setLegend([
        { sym: '<div style="width:40px;height:8px;border-radius:2px;background:linear-gradient(90deg,#8b4513,#c9a227,#d4d44a,#4caf50,#1b5e20)"></div>', label: 'NDVI -0.2 ~ 1.0' },
        { sym: '<svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#ef476f" stroke-width="2.5"/></svg>', label: '国家公园边界' }
    ]);
    clearAllOverlays();
    await ensureLayer('boundary');
    State.map.setView(MAP_CENTER, 8);

    // 显示时间轴
    $('#timelineBar').classList.add('show');
    $('#tlLabel').textContent = 'NDVI 年际变化';
    // 加载 NDVI
    await loadNDVI();
    // 加载降水
    loadPrecip();
    // 默认图表
    renderRemoteChart('NDVI');
}

async function loadNDVI() {
    try {
        const d = await fetchJSON(`${API}/ndvi`);
        State.ndviData = d;
        const years = d.years || [];
        $('#tlRange').min = 0;
        $('#tlRange').max = Math.max(years.length - 1, 0);
        $('#tlRange').value = 0;
        $('#tlYear').textContent = years[0] || 2013;
        renderNDVIThematic(years[0]);
    } catch (e) { State.ndviData = null; }
}

function renderNDVIThematic(year) {
    // 在地图上叠加 NDVI 专题(用边界内栅格近似 - 用色块圆点模拟)
    const d = State.ndviData;
    if (!d) return;
    const records = d.records || [];
    const rec = records.find(r => r.year === year) || records[0];
    if (!rec) return;
    // 移除旧专题
    if (State.layers._ndviTheme) { State.map.removeLayer(State.layers._ndviTheme); }
    const group = L.layerGroup();
    // 在边界范围内生成网格色块
    const bounds = [[37.0, 94.5], [39.6, 103.0]];
    const step = 0.18;
    for (let lat = bounds[0][0]; lat <= bounds[1][0]; lat += step) {
        for (let lng = bounds[0][1]; lng <= bounds[1][1]; lng += step) {
            // 基于 NDVI 均值 + 噪声生成值
            const base = rec.ndvi_mean || 0.6;
            const noise = (Math.sin(lat * 7 + lng * 5 + year) * 0.5 + Math.cos(lng * 3) * 0.3) * 0.22;
            const val = Math.max(-0.2, Math.min(1.0, base + noise));
            const color = ndviColor(val);
            L.circle([lat, lng], { radius: 9000, color: color, fillColor: color, fillOpacity: 0.55, weight: 0, opacity: 0 }).addTo(group);
        }
    }
    group.addTo(State.map);
    State.layers._ndviTheme = group;
}

function ndviColor(v) {
    // -0.2 ~ 1.0 色阶
    const stops = [
        [-0.2, [139, 69, 19]], [0.1, [201, 162, 39]], [0.3, [212, 212, 74]],
        [0.5, [76, 175, 80]], [0.8, [27, 94, 32]], [1.0, [10, 60, 20]]
    ];
    for (let i = 0; i < stops.length - 1; i++) {
        if (v <= stops[i + 1][0]) {
            const t = (v - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
            const c0 = stops[i][1], c1 = stops[i + 1][1];
            const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
            const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
            const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
            return `rgb(${r},${g},${b})`;
        }
    }
    return 'rgb(10,60,20)';
}

function renderRemoteChart(ind) {
    State.currentRSIndicator = ind;
    $('#remoteIndLabel').textContent = RS_INDICATOR_NAMES[ind] || ind;
    const chart = getChart('remoteChart');
    if (!chart) return;
    if (ind === 'NDVI' && State.ndviData) {
        const d = State.ndviData;
        const years = d.years || [];
        const series = d.series || {};
        chart.setOption(Object.assign(chartBase(), {
            legend: { top: 0, right: 10, textStyle: { color: CHART_AXIS, fontSize: 10 }, data: ['均值', '最大值', '最小值'] },
            xAxis: Object.assign({ type: 'category', data: years.map(String) }, axisStyle()),
            yAxis: Object.assign({ type: 'value', name: 'NDVI', nameTextStyle: { color: CHART_AXIS, fontSize: 10 } }, axisStyle()),
            series: [
                { name: '均值', type: 'bar', barWidth: '40%', data: series.ndvi_mean || [], itemStyle: { color: COLORS.accent, borderRadius: [4, 4, 0, 0] } },
                { name: '最大值', type: 'line', smooth: true, data: series.ndvi_max || [], lineStyle: { color: COLORS.success }, itemStyle: { color: COLORS.success } },
                { name: '最小值', type: 'line', smooth: true, data: series.ndvi_min || [], lineStyle: { color: COLORS.warning }, itemStyle: { color: COLORS.warning } }
            ]
        }), true);
    } else {
        // 其他指标: 调用 remote-sensing 接口
        fetchJSON(`${API}/remote-sensing?indicator=${encodeURIComponent(ind)}`).then(d => {
            const inds = d.indicators || [];
            const byYear = {};
            inds.forEach(r => { byYear[r.year] = r.value; });
            const years = Object.keys(byYear).sort();
            chart.setOption(Object.assign(chartBase(), {
                xAxis: Object.assign({ type: 'category', data: years.map(String) }, axisStyle()),
                yAxis: Object.assign({ type: 'value', name: inds[0] ? inds[0].unit || ind : ind, nameTextStyle: { color: CHART_AXIS, fontSize: 10 } }, axisStyle()),
                series: [{
                    name: RS_INDICATOR_NAMES[ind] || ind, type: 'bar', barWidth: '45%',
                    data: years.map(y => byYear[y]),
                    itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: COLORS.accent }, { offset: 1, color: COLORS.accent2 }]), borderRadius: [4, 4, 0, 0] }
                }]
            }), true);
        }).catch(() => {
            chart.setOption({ backgroundColor: 'transparent', title: { text: '暂无该指标数据', left: 'center', top: 'center', textStyle: { color: CHART_AXIS, fontSize: 13 } } }, true);
        });
    }
}

async function loadPrecip() {
    try {
        const d = await fetchJSON(`${API}/precipitation?region=${encodeURIComponent('祁连山全域')}`);
        State.precipData = d;
        renderPrecipChart();
        renderPrecipTable(d);
    } catch (e) { console.warn('降水数据加载失败', e); }
}

function renderPrecipChart() {
    const d = State.precipData;
    if (!d) return;
    const chart = getChart('precipChart');
    if (!chart) return;
    const years = (d.years || []).map(String);
    const vals = d.precipitation_mm || [];
    const isBar = State.precipChartType === 'bar';
    chart.setOption(Object.assign(chartBase({ top: 16 }), {
        xAxis: Object.assign({ type: 'category', data: years }, axisStyle()),
        yAxis: Object.assign({ type: 'value', name: 'mm', nameTextStyle: { color: CHART_AXIS, fontSize: 10 } }, axisStyle()),
        series: [{
            name: '降水量', type: isBar ? 'bar' : 'line', data: vals, barWidth: '50%', smooth: !isBar, symbol: isBar ? 'none' : 'circle', symbolSize: 6,
            itemStyle: { color: COLORS.accent, borderRadius: isBar ? [4, 4, 0, 0] : 0 },
            lineStyle: { color: COLORS.accent, width: 2 },
            areaStyle: isBar ? undefined : { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(0,180,216,0.3)' }, { offset: 1, color: 'rgba(0,180,216,0)' }]) }
        }]
    }), true);
}

function renderPrecipTable(d) {
    const years = d.years || [];
    const vals = d.precipitation_mm || [];
    let html = `<thead><tr><th>年份</th><th>降水量(mm)</th></tr></thead><tbody>`;
    html += years.map((y, i) => `<tr><td>${y}</td><td>${fmt(vals[i], 1)}</td></tr>`).join('');
    html += `</tbody>`;
    $('#precipTable').innerHTML = html;
}

function startTimeline() {
    stopTimeline();
    const d = State.ndviData;
    if (!d) return;
    const years = d.years || [];
    let idx = +$('#tlRange').value;
    State.timelineTimer = setInterval(() => {
        idx = (idx + 1) % years.length;
        $('#tlRange').value = idx;
        $('#tlYear').textContent = years[idx];
        renderNDVIThematic(years[idx]);
        renderRemoteChart('NDVI');
    }, 1200);
    setTimelinePlaying(true);
}
function stopTimeline() {
    if (State.timelineTimer) { clearInterval(State.timelineTimer); State.timelineTimer = null; }
    setTimelinePlaying(false);
}
function setTimelinePlaying(playing) {
    const icon = $('#tlPlayIcon');
    icon.innerHTML = playing ?
        '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>' :
        '<path d="M8 5v14l11-7z"/>';
}

/* =====================================================================
   MODULE 7 - 数据库 / 资源概览
   ===================================================================== */
const DB_TREE = [
    { cat: '山', ico: '山', layers: [
        { id: 'dem_elevation', name: '高程', desc: '数字高程模型(DEM)，分辨率30m' },
        { id: 'dem_slope', name: '坡度', desc: '基于DEM计算的坡度图' },
        { id: 'dem_aspect', name: '坡向', desc: '基于DEM计算的坡向图' },
        { id: 'dem_terrain', name: '山体地形', desc: '山体地形特征分类' }
    ] },
    { cat: '水', ico: '水', layers: [
        { id: 'clim_temp', name: '气温', desc: '年平均气温分布' },
        { id: 'clim_et', name: '蒸散发', desc: '实际蒸散发量' },
        { id: 'clim_precip', name: '降水量', desc: '年降水空间分布' },
        { id: 'rivers', name: '河流水系', desc: '主要河流与支流水系', real: true },
        { id: 'lakes', name: '水源存量', desc: '湖泊与水库分布', real: true }
    ] },
    { cat: '林', ico: '林', layers: [
        { id: 'forest_type', name: '林地类型', desc: '有林地/灌木林/疏林地分类' },
        { id: 'forest_area', name: '森林面积', desc: '森林覆盖面积统计' },
        { id: 'forest_cover', name: '森林覆盖度', desc: '森林覆盖率空间分布' },
        { id: 'ndvi', name: '植被指数', desc: 'NDVI归一化植被指数' },
        { id: 'npp', name: 'NPP', desc: '净初级生产力' }
    ] },
    { cat: '田', ico: '田', layers: [
        { id: 'farmland', name: '耕地分布', desc: '耕地利用类型' },
        { id: 'farmland_quality', name: '耕地质量', desc: '耕地质量等级' }
    ] },
    { cat: '湖', ico: '湖', layers: [
        { id: 'lakes2', name: '湖泊分布', desc: '主要湖泊水体', real: true, realName: 'lakes' },
        { id: 'wetland', name: '湿地分布', desc: '湿地生态系统' }
    ] },
    { cat: '草', ico: '草', layers: [
        { id: 'grassland_type', name: '草地类型', desc: '高寒草甸/草原分类' },
        { id: 'grassland_biomass', name: '草地生物量', desc: '草地地上生物量' }
    ] },
    { cat: '沙', ico: '沙', layers: [
        { id: 'desert', name: '荒漠分布', desc: '荒漠化土地' },
        { id: 'desert_deg', name: '荒漠化程度', desc: '荒漠化等级' }
    ] },
    { cat: '冰', ico: '冰', layers: [
        { id: 'glacier', name: '冰川分布', desc: '现代冰川范围' },
        { id: 'glacier_change', name: '冰川变化', desc: '冰川进退变化' }
    ] }
];

async function modDatabase() {
    setLegend([
        { sym: '<svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#ef476f" stroke-width="2.5"/></svg>', label: '国家公园边界' },
        { sym: '<svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#4dd0e1" stroke-width="2"/></svg>', label: '河流水系' },
        { sym: '<span style="display:inline-block;width:14px;height:10px;background:#4dd0e1;opacity:.5;border-radius:2px"></span>', label: '湖泊水体' }
    ]);
    clearAllOverlays();
    await Promise.all([ensureLayer('boundary'), ensureLayer('provinces'), ensureLayer('rivers'), ensureLayer('lakes')]);
    // 全景视图，包含青海湖(约 [36.9, 100.1])
    State.map.setView([37.8, 100.0], 7);

    buildDbTree();
    renderDbResource();
}

function buildDbTree() {
    const wrap = $('#dbLayerTree');
    wrap.innerHTML = DB_TREE.map((c, ci) => {
        const items = c.layers.map((l, li) =>
            `<div class="ck-row"><input type="checkbox" data-real="${l.real ? (l.realName || l.id) : ''}" data-id="${l.id}" data-name="${esc(l.name)}" data-desc="${esc(l.desc)}"><span>${esc(l.name)}</span></div>`).join('');
        return `<div class="cat-block ${ci < 2 ? 'open' : ''}">
            <div class="cat-head"><span class="cat-ico">${c.ico}</span><span>${c.cat}</span><span class="arrow">▶</span></div>
            <div class="cat-body">${items}</div>
        </div>`;
    }).join('');
    // 折叠
    $$('#dbLayerTree .cat-head').forEach(h => {
        h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
    });
    // 勾选
    $$('#dbLayerTree input').forEach(cb => {
        cb.addEventListener('change', async () => {
            const real = cb.dataset.real;
            if (real) {
                if (cb.checked) await ensureLayer(real);
                else hideLayer(real);
            }
            $('#dbLayerInfo').innerHTML = `<p><span class="hl">${esc(cb.dataset.name)}</span></p><p>${esc(cb.dataset.desc)}</p><p class="muted" style="font-size:11px;">${cb.checked ? '已加载至地图' : '图层已隐藏'}</p>`;
        });
    });
}

function renderDbResource() {
    const totalLayers = DB_TREE.reduce((s, c) => s + c.layers.length, 0);
    const html = `
        <div class="info-stat">
            <div class="stat"><div class="v">${DB_TREE.length}</div><div class="l">图层类别</div></div>
            <div class="stat"><div class="v">${totalLayers}</div><div class="l">专题图层</div></div>
            <div class="stat"><div class="v">10</div><div class="l">基础图层</div></div>
        </div>
        <div class="section-title" style="margin-top:8px;">图层类别概览</div>
        ${DB_TREE.map(c => `<div class="wl-cat"><span class="wl-name"><span class="cat-ico" style="display:inline-flex;width:18px;height:18px;font-size:11px;">${c.ico}</span> ${c.cat}</span><span class="wl-meta"><b>${c.layers.length}</b> 个图层</span></div>`).join('')}`;
    $('#dbResourcePanel').innerHTML = html;
}

/* ============================ 事件绑定 ============================ */
function bindEvents() {
    // 顶部导航
    $('#appNav').addEventListener('click', e => {
        const btn = e.target.closest('.nav-item');
        if (!btn) return;
        const mod = btn.dataset.module;
        // 动植物拆分: 默认进入 wildlife
        if (mod === 'wildlife') switchModule('wildlife');
        else switchModule(mod);
    });

    // 左侧动植物切换: 在 wildlife 面板里提供切到 plants 的入口
    // 通过顶部"动植物"二次点击切换
    let wildlifeToggle = false;
    $('#appNav').addEventListener('dblclick', e => {
        const btn = e.target.closest('.nav-item[data-module="wildlife"]');
        if (!btn) return;
        switchModule(State.module === 'wildlife' ? 'plants' : 'wildlife');
    });

    // 地图工具栏
    $('#mapToolbar').addEventListener('click', e => {
        const btn = e.target.closest('.tool-btn');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'zoomin') State.map.zoomIn();
        else if (act === 'zoomout') State.map.zoomOut();
        else if (act === 'reset') State.map.setView(MAP_CENTER, MAP_ZOOM);
        else if (act === 'layers') toggleLayerPanel();
        else if (act === 'measure') toggleMeasure(btn);
        else if (act === 'fullscreen') toggleFullscreen(btn);
    });

    // 首页 tabs
    $('#homeTabs').addEventListener('click', e => {
        const t = e.target.closest('.tab');
        if (!t) return;
        $$('#homeTabs .tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        $$('.tab-pane[data-pane]').forEach(p => p.classList.toggle('active', p.dataset.pane === t.dataset.tab));
    });

    // 网格监控
    $('#gridSearchBtn').addEventListener('click', doGridSearch);
    $('#gridResetBtn').addEventListener('click', () => {
        $$('#grid .form-control, #gSearch1,#gSearch2,#gSearch3,#gSearch4,#gSearch5,#gSearch6,#gSearch7,#gSearch8').forEach(s => s.value = '');
        doGridSearch();
    });

    // 生态环境
    $('#meteoQueryBtn').addEventListener('click', queryMeteo);
    $('#meteoMetric').addEventListener('change', queryMeteo);
    $('#meteoStation').addEventListener('change', queryMeteo);
    $('#investBtn').addEventListener('click', () => {
        const btn = $('#investBtn');
        btn.textContent = '模型运行中...';
        btn.disabled = true;
        setTimeout(() => { btn.textContent = 'InVEST 模型评估'; btn.disabled = false; }, 1800);
    });

    // 野生动物 chips
    $('#wildlifeChips').addEventListener('click', e => {
        const c = e.target.closest('.chip');
        if (!c) return;
        $$('#wildlifeChips .chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        State.wildlifeSpecies = c.dataset.species;
        loadWildlifeObs(State.wildlifeSpecies);
    });

    // 植物
    $('#plantSimBtn').addEventListener('click', runPlantSim);
    $('#plantSimTime').addEventListener('click', e => {
        const t = e.target.closest('.tb');
        if (!t) return;
        $$('#plantSimTime .tb').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        State.plantSimTime = t.dataset.time;
    });

    // 人类活动
    $('#humanSearchBtn').addEventListener('click', doHumanSearch);

    // 遥感
    $('#remoteIndList').addEventListener('click', e => {
        const b = e.target.closest('.ind-ts');
        if (!b) return;
        renderRemoteChart(b.dataset.ind);
        $('#tlLabel').textContent = (RS_INDICATOR_NAMES[b.dataset.ind] || b.dataset.ind) + ' 年际变化';
    });
    $('#remoteSubtabs').addEventListener('click', e => {
        const t = e.target.closest('.subtab');
        if (!t) return;
        $$('#remoteSubtabs .subtab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
    });
    $('#tlPlay').addEventListener('click', () => {
        if (State.timelineTimer) stopTimeline();
        else startTimeline();
    });
    $('#tlRange').addEventListener('input', () => {
        const d = State.ndviData;
        if (!d) return;
        const years = d.years || [];
        const idx = +$('#tlRange').value;
        $('#tlYear').textContent = years[idx] || '';
        renderNDVIThematic(years[idx]);
    });
    $('#precipToggle').addEventListener('click', e => {
        const t = e.target.closest('.tg');
        if (!t) return;
        $$('#precipToggle .tg').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        State.precipChartType = t.dataset.type;
        renderPrecipChart();
    });

    // 窗口尺寸变化
    window.addEventListener('resize', () => {
        if (State.map) State.map.invalidateSize();
        resizeAllCharts();
    });
}

/* ---- 地图工具: 图层面板 / 测量 / 全屏 ---- */
function toggleLayerPanel() {
    // 简易: 切换到首页的图层控制(若不在首页, 提示)
    if (State.module !== 'home') {
        switchModule('home');
    }
    $('#homeLayerControl').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

let measureActive = false, measureLayer = null, measurePoints = [];
function toggleMeasure(btn) {
    measureActive = !measureActive;
    btn.classList.toggle('active', measureActive);
    State.map.getContainer().style.cursor = measureActive ? 'crosshair' : '';
    if (measureActive) {
        if (!measureLayer) measureLayer = L.layerGroup().addTo(State.map);
        measurePoints = [];
        State.map.on('click', onMeasureClick);
        State.map.on('dblclick', finishMeasure);
    } else {
        State.map.off('click', onMeasureClick);
        State.map.off('dblclick', finishMeasure);
    }
}
function onMeasureClick(e) {
    measurePoints.push(e.latlng);
    L.circleMarker(e.latlng, { radius: 4, color: COLORS.accent, fillColor: COLORS.accent, fillOpacity: 1 }).addTo(measureLayer);
    if (measurePoints.length >= 2) {
        const line = L.polyline(measurePoints, { color: COLORS.accent, weight: 2, dashArray: '5,5' });
        measureLayer.clearLayers();
        measureLayer.addLayer(line);
        measurePoints.forEach(p => L.circleMarker(p, { radius: 4, color: COLORS.accent, fillColor: COLORS.accent, fillOpacity: 1 }).addTo(measureLayer));
        let dist = 0;
        for (let i = 1; i < measurePoints.length; i++) dist += measurePoints[i].distanceTo(measurePoints[i - 1]);
        const txt = dist > 1000 ? (dist / 1000).toFixed(2) + ' km' : dist.toFixed(1) + ' m';
        L.tooltip({ permanent: true }).setContent('总长: ' + txt).setLatLng(measurePoints[measurePoints.length - 1]).addTo(measureLayer);
    }
}
function finishMeasure() {
    measureActive = false;
    $('.tool-btn[data-act="measure"]').classList.remove('active');
    State.map.getContainer().style.cursor = '';
    State.map.off('click', onMeasureClick);
    State.map.off('dblclick', finishMeasure);
}

function toggleFullscreen(btn) {
    const el = document.getElementById('app');
    if (!document.fullscreenElement) {
        el.requestFullscreen && el.requestFullscreen();
        btn.classList.add('active');
    } else {
        document.exitFullscreen && document.exitFullscreen();
        btn.classList.remove('active');
    }
}

/* ============================ 动植物模块切换提示 ============================ */
// 在 wildlife 模块右下角增加切换到 plants 的按钮(动态注入)
function ensureFloraFaunaSwitch() {
    if (document.getElementById('ffSwitch')) return;
    const btn = document.createElement('button');
    btn.id = 'ffSwitch';
    btn.style.cssText = 'position:absolute;right:12px;top:12px;z-index:800;background:rgba(26,39,51,.92);border:1px solid #00b4d8;color:#00b4d8;padding:6px 14px;border-radius:5px;font-size:12px;cursor:pointer;display:none;';
    btn.innerHTML = '切换至 濒危植物监控 ▸';
    document.getElementById('mapRegion').appendChild(btn);
    btn.addEventListener('click', () => {
        if (State.module === 'wildlife') { switchModule('plants'); btn.innerHTML = '◂ 切换至 野生动物监控'; }
        else { switchModule('wildlife'); btn.innerHTML = '切换至 濒危植物监控 ▸'; }
    });
}
function updateFFSwitch() {
    const btn = document.getElementById('ffSwitch');
    if (!btn) return;
    const show = (State.module === 'wildlife' || State.module === 'plants');
    btn.style.display = show ? 'block' : 'none';
    btn.innerHTML = State.module === 'wildlife' ? '切换至 濒危植物监控 ▸' : '◂ 切换至 野生动物监控';
}

// hook 进 switchModule
const _origSwitch = switchModule;
switchModule = function (mod) {
    _origSwitch(mod);
    updateFFSwitch();
};

/* ============================ 启动 ============================ */
function init() {
    initMap();
    bindEvents();
    ensureFloraFaunaSwitch();
    switchModule('home');
}
document.addEventListener('DOMContentLoaded', init);

})();
