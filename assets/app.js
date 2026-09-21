
    // ================= 全局数据与颜色映射 =================
    window.EPOCH_COLOR_MAP = {
        "c1": "#679B66", "c2": "#99C2B5", "d1": "#E5AC4D", "d2": "#F1C868", "d3": "#F1E19D",
        "e1": "#FDA75F", "e2": "#FDB46C", "e3": "#FDC07A", "j1": "#42AED0", "j2": "#80CFD8",
        "j3": "#B3E3EE", "k1": "#8CCD51", "k2": "#A6D84A", "n1": "#FFFF00", "n2": "#FFFF99",
        "p1": "#EF5845", "p2": "#FB745C", "p3": "#FBA794", "s1": "#99D7B3", "s2": "#B3E1C2",
        "s3": "#BFE6CF", "s4": "#E6F5E1", "t1": "#983999", "t2": "#B168B1", "t3": "#BD8CC3"
    };
    window.globalJson = null;
    let evidenceRawCounts = { "Inertinite/Charcoal":0, "Fossil Charcoal (FC)":0, "Natural char":0, "Polycyclic aromatic hydrocarbons":0, "Fire Scar":0 };
    let epochCounts = {};
    window.PERIOD_ORDER = ["S","D","C","P","T","J","K","E","N"];
    window.PERIOD_DATA = {
        "S": { name: "Silurian", fullName: "Silurian", color: "#B3FFBF", description: "Silurian (443.8–419.2 Ma)" },
        "D": { name: "Devonian", fullName: "Devonian", color: "#F1C868", description: "Devonian (419.2–358.9 Ma)" },
        "C": { name: "Carboniferous", fullName: "Carboniferous", color: "#99C2B5", description: "Carboniferous (358.9–298.9 Ma)" },
        "P": { name: "Permian", fullName: "Permian", color: "#FDB46C", description: "Permian (298.9–252.2 Ma)" },
        "T": { name: "Triassic", fullName: "Triassic", color: "#B168B1", description: "Triassic (252.2–201.3 Ma)" },
        "J": { name: "Jurassic", fullName: "Jurassic", color: "#80CFD8", description: "Jurassic (201.3–145 Ma)" },
        "K": { name: "Cretaceous", fullName: "Cretaceous", color: "#A6D84A", description: "Cretaceous (145–66 Ma)" },
        "E": { name: "Paleogene", fullName: "Paleogene", color: "#FDA75F", description: "Paleogene (66–23 Ma)" },
        "N": { name: "Neogene", fullName: "Neogene", color: "#FFFF00", description: "Neogene (23–2.6 Ma)" }
    };
    window.strataMapping = {
        "s2": { name_en: "Wenlock", short: "S2", periodCode: "S", baseAge: 430.6 }, "s3": { name_en: "Ludlow", short: "S3", periodCode: "S", baseAge: 426.7 }, "s4": { name_en: "Pridoli", short: "S4", periodCode: "S", baseAge: 422.7 }, "s1": { name_en: "Llandovery", short: "S1", periodCode: "S", baseAge: 441 },
        "d1": { name_en: "Early Devonian", short: "D1", periodCode: "D", baseAge: 419.62 }, "d2": { name_en: "Middle Devonian", short: "D2", periodCode: "D", baseAge: 393.47 }, "d3": { name_en: "Late Devonian", short: "D3", periodCode: "D", baseAge: 382.31 },
        "c1": { name_en: "Early Carboniferous", short: "C1", periodCode: "C", baseAge: 358.86 }, "c2": { name_en: "Late Carboniferous", short: "C2", periodCode: "C", baseAge: 323.4 },
        "p1": { name_en: "Cisuralian", short: "P1", periodCode: "P", baseAge: 298.9 }, "p2": { name_en: "Guadalupian", short: "P2", periodCode: "P", baseAge: 274.4 }, "p3": { name_en: "Lopingian", short: "P3", periodCode: "P", baseAge: 259.51 },
        "t1": { name_en: "Early Triassic", short: "T1", periodCode: "T", baseAge: 251.9 }, "t2": { name_en: "Middle Triassic", short: "T2", periodCode: "T", baseAge: 241.464 }, "t3": { name_en: "Late Triassic", short: "T3", periodCode: "T", baseAge: 227.3 },
        "j1": { name_en: "Early Jurassic", short: "J1", periodCode: "J", baseAge: 201.4 }, "j2": { name_en: "Middle Jurassic", short: "J2", periodCode: "J", baseAge: 170.3 }, "j3": { name_en: "Late Jurassic", short: "J3", periodCode: "J", baseAge: 149.2 },
        "k1": { name_en: "Early Cretaceous", short: "K1", periodCode: "K", baseAge: 143.1 }, "k2": { name_en: "Late Cretaceous", short: "K2", periodCode: "K", baseAge: 100.5 },
        "e1": { name_en: "Paleocene", short: "E1", periodCode: "E", baseAge: 66.0 }, "e2": { name_en: "Eocene", short: "E2", periodCode: "E", baseAge: 56.0 }, "e3": { name_en: "Oligocene", short: "E3", periodCode: "E", baseAge: 33.9 },
        "n1": { name_en: "Miocene", short: "N1", periodCode: "N", baseAge: 23.04 }, "n2": { name_en: "Pliocene", short: "N2", periodCode: "N", baseAge: 5.33 }
    };
    window.normalizeEvidenceFullName = function(raw) { if (!raw) return "Unspecified"; const parts = raw.split(/[\/,;]+/).map(s => s.trim().toLowerCase()); const map = { "fc":"Fossil Charcoal", "fossil charcoal":"Fossil Charcoal", "pah":"Polycyclic aromatic hydrocarbons", "pahs":"Polycyclic aromatic hydrocarbons", "inertinite":"Inertinite", "inert":"Inertinite", "charcoal":"Inertinite", "natural char":"Natural Char", "natural charcoal":"Natural Char" }; const fulls = parts.map(p => map[p] || (p.length>2 ? p.charAt(0).toUpperCase()+p.slice(1) : p.toUpperCase())); return [...new Set(fulls)].join(" / "); }
    async function loadData() { if (window.globalJson) return true; try { const res = await fetch('paleo_data.json?t='+Date.now()); if(!res.ok) throw new Error(); const data = await res.json(); globalJson = data; for(let k in evidenceRawCounts) evidenceRawCounts[k]=0; epochCounts = {}; for(let key in strataMapping) epochCounts[key] = 0; for(let [fkey, fcont] of Object.entries(data)) { if(!fcont.data) continue; const epochKey = fkey.toLowerCase(); if(epochCounts[epochKey] === undefined) epochCounts[epochKey] = 0; for(let pt of fcont.data) { epochCounts[epochKey]++; let evRaw = pt['Wildfire evidence type'] || ""; let lower = evRaw.toLowerCase(); if(/(inert|inertinite|charcoal)/i.test(lower) && !/fossil\s*charcoal/i.test(lower)) evidenceRawCounts["Inertinite/Charcoal"]++; if(/\b(fc|fossil\s*charcoal)\b/i.test(lower)) evidenceRawCounts["Fossil Charcoal (FC)"]++; if(/\b(natural\s*char)\b/i.test(lower)) evidenceRawCounts["Natural char"]++; if(/\b(pah|pahs|polycyclic aromatic hydrocarbons)\b/i.test(lower)) evidenceRawCounts["Polycyclic aromatic hydrocarbons"]++; if(/\b(fire\s*scar)\b/i.test(lower)) evidenceRawCounts["Fire Scar"]++; } } return true; } catch(e) { console.error(e); return false; } }
    // 地图与树
    let modernMap = null, layerGroups = {}, allVisible = true, currentSelectedStrata = null, markersMap = new Map();
    function buildStrataTree() { const container = document.getElementById('strata-list'); if(!container) return; container.innerHTML = ''; const groups = new Map(); for (let [key, info] of Object.entries(strataMapping)) { if(!globalJson[key]) continue; const period = info.periodCode; if(!groups.has(period)) groups.set(period, []); groups.get(period).push({ key, epochName: info.name_en, short: info.short, count: globalJson[key].data.length, baseAge: info.baseAge }); } for(let period of PERIOD_ORDER) { const epochList = groups.get(period) || []; epochList.sort((a,b)=>b.baseAge - a.baseAge); const periodTotal = epochList.reduce((s,e)=>s+e.count,0); const periodDiv = document.createElement('div'); periodDiv.className = 'period-group'; const header = document.createElement('div'); header.className = 'period-header'; header.innerHTML = `<div class="period-name"><i class="fas fa-layer-group"></i> ${PERIOD_DATA[period].name}</div><div><span class="period-count">${periodTotal}</span> <i class="fas fa-chevron-right toggle-icon"></i></div>`; const epochUl = document.createElement('ul'); epochUl.className = 'epoch-list'; epochList.forEach(epoch => { const li = document.createElement('li'); li.className = 'epoch-item'; li.dataset.key = epoch.key; li.innerHTML = `<span class="epoch-name">${epoch.epochName} (${epoch.short})</span><span class="epoch-count">${epoch.count}</span>`; li.addEventListener('click', (e) => { e.stopPropagation(); document.querySelectorAll('.epoch-item').forEach(el=>el.classList.remove('active')); li.classList.add('active'); currentSelectedStrata = epoch.key; document.getElementById('selected-strata-title').innerHTML = `Selected: ${PERIOD_DATA[period].name} - ${epoch.epochName} (${epoch.count} records)`; updatePointsTable(epoch.key); for(let k in layerGroups) { if(k === epoch.key) layerGroups[k].addTo(modernMap); else modernMap.removeLayer(layerGroups[k]); } allVisible = false; document.getElementById('toggle-all-layers').innerHTML = '<i class="fas fa-eye"></i> Show All'; }); epochUl.appendChild(li); }); periodDiv.appendChild(header); periodDiv.appendChild(epochUl); container.appendChild(periodDiv); header.addEventListener('click', () => { epochUl.classList.toggle('open'); const icon = header.querySelector('.toggle-icon'); if(epochUl.classList.contains('open')) { icon.classList.remove('fa-chevron-right'); icon.classList.add('fa-chevron-down'); } else { icon.classList.remove('fa-chevron-down'); icon.classList.add('fa-chevron-right'); } }); } }
    function updatePointsTable(strataKey) {
      const tbody = document.getElementById('table-body');
      const query = document.getElementById('record-search').value.trim().toLowerCase();
      const records = strataKey ? (globalJson[strataKey]?.data || []) : Object.values(globalJson).flatMap(group => group.data || []).sort((a,b) => a.id-b.id);
      const points = records.filter(pt => !query || (/^#?\d+$/.test(query) ? pt.id === Number(query.replace('#','')) : `${pt.id} ${pt['Wildfire evidence type']} ${pt['Reference']} ${pt.lithostratigraphicUnit || ''} ${pt.lat} ${pt.lng}`.toLowerCase().includes(query)));
      tbody.replaceChildren();
      document.getElementById('table-title').textContent = `${points.length.toLocaleString('en-US')} ${points.length === 1 ? 'record' : 'records'}${strataKey ? ' / ' + strataMapping[strataKey].name_en : ' / All periods'}`;
      points.forEach(pt => {
        const row=tbody.insertRow(); row.tabIndex=0;
        row.insertCell().textContent=pt.id;
        row.insertCell().textContent=normalizeEvidenceFullName(pt['Wildfire evidence type']);
        row.insertCell().textContent=pt.lithostratigraphicUnit || '—';
        row.insertCell().textContent=`${pt.lat.toFixed(2)}°, ${pt.lng.toFixed(2)}°`;
        row.insertCell().textContent=pt['Reference'] || '—';
        const focus=()=>{const marker=markersMap.get(pt.id); if(marker){marker.openPopup();modernMap.setView([pt.lat,pt.lng],7);}};
        row.addEventListener('click',focus); row.addEventListener('keydown',event=>{if(event.key==='Enter')focus();});
      });
      if(!points.length){const cell=tbody.insertRow().insertCell();cell.colSpan=5;cell.className='empty-data';cell.textContent='No matching records. Try another ID, unit or reference.';}
    }
    function buildModernRecordPopup(pt, fullStrata, evFull) {
      const popup=document.createElement('div');popup.className='record-map-popup';
      const title=document.createElement('h3');title.textContent=`Record #${pt.id}`;popup.append(title);
      const fields=[['Period (Epoch)',fullStrata],['Lithostratigraphic unit',pt.lithostratigraphicUnit || '—'],
        ['Coordinates',`${pt.lat.toFixed(2)}°, ${pt.lng.toFixed(2)}°`],['Proxy type',evFull],['Reference',pt.Reference || '—']];
      for(const [label,value] of fields) {
        const row=document.createElement('div'),name=document.createElement('strong'),text=document.createElement('span');
        row.className='record-map-field';name.textContent=label;text.textContent=value;row.append(name,text);popup.append(row);
      }
      return popup;
    }
    async function initModernMap() { if(modernMap) return; await loadData(); modernMap = L.map('modern-map', { maxBounds: [[-90,-180],[90,180]], maxBoundsViscosity: 0.9 }).setView([30,0],2); const baseMaps = { "🌍 OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxZoom: 19 }), "🛰️ Satellite Imagery": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri' }) }; baseMaps["🌍 OpenStreetMap"].addTo(modernMap); L.control.layers(baseMaps).addTo(modernMap); layerGroups = {}; markersMap.clear(); for(let [fkey, fcont] of Object.entries(globalJson)) { if(!fcont.data?.length) continue; const epochKey = fkey.toLowerCase(); const color = EPOCH_COLOR_MAP[epochKey] || "#aaa"; const group = L.layerGroup(); fcont.data.forEach(pt => { const marker = L.circleMarker([pt.lat, pt.lng], { radius: 6, fillColor: color, color: '#2c3e33', weight: 1, fillOpacity: 0.85 }); const epochInfo = strataMapping[epochKey]; const fullStrata = `${epochInfo?.name_en || epochKey} (${epochInfo?.short || epochKey})`; const evFull = normalizeEvidenceFullName(pt['Wildfire evidence type']); marker.bindPopup(buildModernRecordPopup(pt, fullStrata, evFull), {maxWidth:360}); marker.addTo(group); markersMap.set(pt.id, marker); }); layerGroups[fkey] = group; if(allVisible) group.addTo(modernMap); } buildStrataTree(); document.getElementById('reset-map-view').onclick = () => modernMap.setView([30,0],2); document.getElementById('toggle-all-layers').onclick = () => { allVisible = !allVisible; for(let k in layerGroups) allVisible ? layerGroups[k].addTo(modernMap) : modernMap.removeLayer(layerGroups[k]); document.getElementById('toggle-all-layers').innerHTML = allVisible ? '<i class="fas fa-eye-slash"></i> Hide All' : '<i class="fas fa-eye"></i> Show All'; }; }
    // 统计图表
    let epochBarChart, epochPieChart, evBarChart, evPieChart;
    async function renderStatsCharts() { await loadData(); const epochItems = []; for(let [key, info] of Object.entries(strataMapping)) { if(epochCounts[key] && epochCounts[key] > 0) { epochItems.push({ short: info.short, count: epochCounts[key], baseAge: info.baseAge, epochKey: key }); } } epochItems.sort((a,b)=>b.baseAge - a.baseAge); const labels = epochItems.map(e => e.short); const data = epochItems.map(e => e.count); const barColors = epochItems.map(e => EPOCH_COLOR_MAP[e.epochKey] || "#7f8c8d"); if(epochBarChart) epochBarChart.destroy(); epochBarChart = new Chart(document.getElementById('period-bar-chart'), { type:'bar', data:{ labels, datasets:[{ label:'Wildfire records', data, backgroundColor:barColors, borderRadius:0 }] }, options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true } }, plugins:{ legend:{ display:false }, tooltip:{ enabled:true } } } }); if(epochPieChart) epochPieChart.destroy(); epochPieChart = new Chart(document.getElementById('period-pie-chart'), { type:'pie', data:{ labels, datasets:[{ data, backgroundColor:barColors }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false }, tooltip:{ enabled:true } } } }); const evLabels = ["Inertinite (Inert)","Fossil Charcoal (FC)","PAHs","Natural Char","Fire Scar"]; const evVals = [evidenceRawCounts["Inertinite/Charcoal"], evidenceRawCounts["Fossil Charcoal (FC)"], evidenceRawCounts["Polycyclic aromatic hydrocarbons"], evidenceRawCounts["Natural char"], evidenceRawCounts["Fire Scar"]]; if(evBarChart) evBarChart.destroy(); evBarChart = new Chart(document.getElementById('evidence-bar-chart'), { type:'bar', data:{ labels:evLabels, datasets:[{ label:'Occurrences', data:evVals, backgroundColor:['#314f67','#708d8d','#b39b70','#bec3b3','#dc6d45'], borderRadius:0 }] }, options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true } }, plugins:{ legend:{ display:false }, tooltip:{ enabled:true } } } }); if(evPieChart) evPieChart.destroy(); evPieChart = new Chart(document.getElementById('evidence-pie-chart'), { type:'pie', data:{ labels:evLabels, datasets:[{ data:evVals, backgroundColor:['#314f67','#708d8d','#b39b70','#bec3b3','#dc6d45'] }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false }, tooltip:{ enabled:true } } } }); }
    // 下载功能 (Data页面)
    function setupDataDownload() { const btn = document.getElementById('download-xlsx-btn-data'); if(!btn) return; btn.addEventListener('click', () => { const fileUrl = 'data/Records of global Phanerozoic paleowildfire.xlsx'; btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Checking...'; btn.disabled = true; fetch(fileUrl, { method: 'HEAD' }).then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return fetch(fileUrl); }).then(res => res.blob()).then(blob => { const a = document.createElement('a'); const url = URL.createObjectURL(blob); a.href = url; a.download = 'Records of global Phanerozoic paleowildfire.xlsx'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); }).catch(err => { alert(`❌ Download failed: ${err.message}\nPlease ensure file exists at ${fileUrl}`); }).finally(() => { btn.innerHTML = 'Download Full Dataset (.xlsx)'; btn.disabled = false; }); }); }
    // Navigation and common interactions.
    const pageNames = {home:'Home',data:'Data explorer',reconstruction:'Reconstruction',stats:'Statistics',team:'Research team'};
    window.reconstructionReady = new Promise(resolve => { window.resolveReconstructionReady = resolve; });
    window.gppdDataReady = loadData().then(ok => {
      if (ok) {
        const total = Object.values(window.globalJson).reduce((sum, group) => sum + (group.data?.length || 0), 0);
        document.querySelectorAll('[data-record-count]').forEach(el => { el.textContent = total.toLocaleString('en-US'); });
      }
      return ok;
    });

    function makeKeyboardClickable(elements) {
      elements.forEach(el => {
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.click(); }
        });
      });
    }

    async function showPage(pageId) {
      const page = document.getElementById(pageId);
      if (!page) return;
      const key = pageId.replace('-page', '');
      document.querySelectorAll('.page').forEach(p => p.classList.toggle('page-hidden', p !== page));
      if (key === 'home') page.scrollTop = 0;
      document.querySelectorAll('.nav-btn').forEach(button => {
        if (button.dataset.page === key) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
      if (location.hash !== '#' + key) history.pushState(null, '', '#' + key);
      document.title = (key === 'home' ? 'GPPD' : pageNames[key] + ' · GPPD') + ' | Global Phanerozoic Paleowildfire Database';
      if (key !== 'reconstruction') window.pauseReconstruction?.();
      try {
        if (['data','reconstruction','stats'].includes(key)) {
          if (!await window.gppdDataReady) throw new Error('The record data could not be loaded. Please reload the page.');
        }
        if (key === 'data') {
          if (!window._modernInit) {
            window._modernInit = true;
            await initModernMap();
            setupDataDownload();
            updatePointsTable(null);
            document.getElementById('toggle-all-layers').textContent = 'Hide all points';
            makeKeyboardClickable(document.querySelectorAll('.period-header, .epoch-item'));
          }
          requestAnimationFrame(() => modernMap?.invalidateSize());
        }
        if (key === 'stats') {
          Chart.defaults.font.family = 'Arial, Helvetica, sans-serif';
          Chart.defaults.font.size = 11;
          Chart.defaults.color = '#697580';
          await renderStatsCharts();
        }
        if (key === 'reconstruction') {
          window._reconInitPromise ||= (async () => {
            const ready = await window.reconstructionReady;
            if (!ready) throw new Error('The 3D library could not be loaded. Please reload the page.');
            await window.initReconstructionGlobe();
          })();
          await window._reconInitPromise;
        }
        window.dispatchEvent(new Event('resize'));
      } catch (error) {
        console.error(error);
        const status = page.querySelector('#reconLoadingText, #selected-strata-title');
        if (status) status.textContent = error.message;
      }
    }
    document.querySelectorAll('.nav-btn').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page + '-page')));
    document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.open + '-page')));
    for (const key of ['data','reconstruction','stats','team']) document.getElementById('home-goto-' + key).onclick = () => showPage(key + '-page');
    document.querySelectorAll('.back-home-btn').forEach(button => { button.onclick = () => showPage('home-page'); });
    document.getElementById('discover-archive').onclick = () => document.getElementById('home-modules').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    document.getElementById('record-search').addEventListener('input', () => updatePointsTable(currentSelectedStrata));
    document.getElementById('all-records').onclick = () => {
      currentSelectedStrata = null;
      document.getElementById('record-search').value = '';
      document.querySelectorAll('.epoch-item').forEach(item => item.classList.remove('active'));
      document.getElementById('selected-strata-title').textContent = 'GEOLOGICAL PERIODS';
      updatePointsTable(null);
      Object.values(layerGroups).forEach(group => group.addTo(modernMap));
      allVisible = true;
      document.getElementById('toggle-all-layers').textContent = 'Hide all points';
    };
    const openRoute = () => {
      const key = location.hash.slice(1);
      showPage((Object.hasOwn(pageNames, key) ? key : 'home') + '-page');
    };
    window.addEventListener('popstate', openRoute);
    window.addEventListener('hashchange', openRoute);
    openRoute();
