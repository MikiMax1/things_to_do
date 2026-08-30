// Kingdom of Ashveil - game logic
(function(){
var cols=6, rows=6, cell=44, pad=10;
  var tiles=[];
  for(var row=0; row<rows; row++){
    for(var col=0; col<cols; col++){
      tiles.push({row:row,col:col, x: pad+col*cell, y: pad+row*cell, bld:null});
    }
  }

  var buildings = {
    farm: {label:'Farm', cost:30, upkeep:0, letter:'F', fill:'#C0DD97', stroke:'#3B6D11', textColor:'#173404'},
    house: {label:'House', cost:40, upkeep:2, letter:'H', fill:'#9FE1CB', stroke:'#0F6E56', textColor:'#04342C'},
    market: {label:'Market', cost:60, upkeep:3, letter:'M', fill:'#FAC775', stroke:'#854F0B', textColor:'#412402'},
    barracks: {label:'Barracks', cost:80, upkeep:4, letter:'B', fill:'#F0997B', stroke:'#993C1D', textColor:'#4A1B0C'},
    tower: {label:'Watchtower', cost:70, upkeep:2, letter:'T', fill:'#AFA9EC', stroke:'#3C3489', textColor:'#26215C'}
  };

  var castleTiers = [
    {name:'Wooden hall', cost:0, bonus:'starting hall'},
    {name:'Stone keep', cost:150, bonus:'+10% gold income'},
    {name:'Grand castle', cost:350, bonus:'+10% food production and +20 max army'}
  ];

  var questPool = [
    {id:'q1', label:'Build 3 farms', check:function(c){ return c.farm>=3; }, reward:{gold:60}, done:false},
    {id:'q2', label:'Reach population 20', check:function(){ return s.pop>=20; }, reward:{gold:80}, done:false},
    {id:'q3', label:'Build a barracks', check:function(c){ return c.barracks>=1; }, reward:{gold:50}, done:false},
    {id:'q4', label:'Save up 400 gold', check:function(){ return s.gold>=400; }, reward:{army:8}, done:false},
    {id:'q5', label:'Build 2 markets', check:function(c){ return c.market>=2; }, reward:{gold:70}, done:false},
    {id:'q6', label:'Build a watchtower', check:function(c){ return c.tower>=1; }, reward:{gold:50}, done:false}
  ];

  var milestones = [
    {label:'Village founded', target:0, kind:'pop', hit:true},
    {label:'Population 10', target:10, kind:'pop', hit:false},
    {label:'Population 30', target:30, kind:'pop', hit:false},
    {label:'Population 60', target:60, kind:'pop', hit:false},
    {label:'Treasury 500g', target:500, kind:'gold', hit:false},
    {label:'Army of 50', target:50, kind:'army', hit:false}
  ];

  var s = { gold:300, food:200, pop:0, army:10, season:1, selected:'farm', log:[], castleTier:0, rivalStr:40, allied:false };

  function pushLog(msg){
    s.log.unshift(msg);
    if(s.log.length>8) s.log.pop();
    var el = document.getElementById('log');
    el.innerHTML = s.log.map(function(m){ return '<div>'+m+'</div>'; }).join('');
  }

  var svgNS = "http://www.w3.org/2000/svg";
  var mapEl = document.getElementById('map');
  mapEl.setAttribute('viewBox','0 0 280 280');

  function renderMap(){
    while(mapEl.firstChild) mapEl.removeChild(mapEl.firstChild);
    tiles.forEach(function(t){
      var g = document.createElementNS(svgNS,'g');
      g.setAttribute('class','tile');

      var rect = document.createElementNS(svgNS,'rect');
      rect.setAttribute('x', t.x); rect.setAttribute('y', t.y);
      rect.setAttribute('width', cell-3); rect.setAttribute('height', cell-3);
      rect.setAttribute('rx', 4);
      var def = t.bld ? buildings[t.bld] : null;
      rect.setAttribute('fill', def ? def.fill : '#F1EFE8');
      rect.setAttribute('stroke', def ? def.stroke : '#D3D1C7');
      rect.setAttribute('stroke-width', '1');
      g.appendChild(rect);

      if(def){
        var txt = document.createElementNS(svgNS,'text');
        txt.setAttribute('x', t.x + (cell-3)/2);
        txt.setAttribute('y', t.y + (cell-3)/2 + 5);
        txt.setAttribute('text-anchor','middle');
        txt.setAttribute('font-size','16');
        txt.setAttribute('font-weight','600');
        txt.setAttribute('fill', def.textColor);
        txt.textContent = def.letter;
        g.appendChild(txt);
      }

      g.addEventListener('click', (function(tile){ return function(){ placeAt(tile); }; })(t));
      mapEl.appendChild(g);
    });
  }

  function placeAt(t){
    if(s.selected === 'clear'){
      if(t.bld){ t.bld = null; renderMap(); pushLog('Cleared a tile.'); }
      return;
    }
    var def = buildings[s.selected];
    if(t.bld){ pushLog('That tile is already built on.'); return; }
    if(s.gold < def.cost){ pushLog('Not enough gold for a ' + def.label.toLowerCase() + '.'); return; }
    s.gold -= def.cost;
    t.bld = s.selected;
    pushLog('Built a ' + def.label.toLowerCase() + ' for ' + def.cost + 'g.');
    renderMap();
    updateStats();
    checkQuests();
  }

  var toolKeys = ['farm','house','market','barracks','tower','clear'];
  toolKeys.forEach(function(k){
    var btn = document.getElementById('b-'+k);
    btn.addEventListener('click', function(){
      s.selected = k;
      toolKeys.forEach(function(kk){ document.getElementById('b-'+kk).classList.remove('active'); });
      btn.classList.add('active');
      if(k === 'clear'){
        document.getElementById('sel-label').textContent = 'Eraser';
        document.getElementById('sel-cost').textContent = '';
      } else {
        document.getElementById('sel-label').textContent = buildings[k].label;
        document.getElementById('sel-cost').textContent = '(' + buildings[k].cost + 'g)';
      }
    });
  });
  document.getElementById('b-farm').classList.add('active');

  function counts(){
    var c = {farm:0, house:0, market:0, barracks:0, tower:0};
    tiles.forEach(function(t){ if(t.bld) c[t.bld]++; });
    return c;
  }

  function updateStats(){
    document.getElementById('stat-gold').textContent = Math.round(s.gold).toLocaleString();
    document.getElementById('stat-food').textContent = Math.round(s.food).toLocaleString();
    document.getElementById('stat-pop').textContent = Math.round(s.pop).toLocaleString();
    document.getElementById('stat-army').textContent = Math.round(s.army).toLocaleString();
    document.getElementById('rival-str').textContent = Math.round(s.rivalStr).toLocaleString() + (s.allied ? ' (allied)' : '');
    document.getElementById('turn-label').textContent = 'Season ' + s.season + (s.allied ? ' \u00b7 allied with Brannoch' : '');

    document.getElementById('castle-tier').textContent = castleTiers[s.castleTier].name + ' \u2014 ' + castleTiers[s.castleTier].bonus;
    var nextTier = castleTiers[s.castleTier+1];
    var upBtn = document.getElementById('upgrade-castle');
    if(nextTier){
      upBtn.style.display = 'block';
      document.getElementById('upgrade-cost').textContent = '(' + nextTier.cost + 'g)';
      document.getElementById('castle-bar').style.width = Math.min(100, (s.gold/nextTier.cost)*100) + '%';
    } else {
      upBtn.style.display = 'none';
      document.getElementById('castle-bar').style.width = '100%';
    }
    renderMilestones();
  }

  function renderMilestones(){
    milestones.forEach(function(m){
      if(m.hit) return;
      var val = m.kind==='pop' ? s.pop : m.kind==='gold' ? s.gold : s.army;
      if(val >= m.target) m.hit = true;
    });
    var el = document.getElementById('milestones');
    el.innerHTML = milestones.map(function(m){
      return '<div class="mrow"><span class="dot'+(m.hit?' hit':'')+'"></span><span class="'+(m.hit?'done':'pending')+'">'+m.label+'</span></div>';
    }).join('');
  }

  function renderQuests(){
    var el = document.getElementById('quests');
    var active = questPool.filter(function(q){ return !q.done; }).slice(0,3);
    el.innerHTML = active.length ? active.map(function(q){
      var rewardTxt = q.reward.gold ? ('+' + q.reward.gold + 'g') : ('+' + q.reward.army + ' army');
      return '<div class="questcard"><p class="qlabel">' + q.label + '</p><p class="qreward">Reward: ' + rewardTxt + '</p></div>';
    }).join('') : '<p style="font-size:12px; color:#6B6A63; margin:0;">All quests complete for now.</p>';
  }

  function checkQuests(){
    var c = counts();
    questPool.forEach(function(q){
      if(!q.done && q.check(c)){
        q.done = true;
        if(q.reward.gold) s.gold += q.reward.gold;
        if(q.reward.army) s.army += q.reward.army;
        pushLog('Quest complete: ' + q.label + '. Reward claimed.');
      }
    });
    renderQuests();
    updateStats();
  }

  document.getElementById('upgrade-castle').addEventListener('click', function(){
    var nextTier = castleTiers[s.castleTier+1];
    if(!nextTier) return;
    if(s.gold < nextTier.cost){ pushLog('Not enough gold to upgrade the castle.'); return; }
    s.gold -= nextTier.cost;
    s.castleTier += 1;
    pushLog('Castle upgraded to ' + castleTiers[s.castleTier].name + '.');
    updateStats();
  });

  document.getElementById('act-raid').addEventListener('click', function(){
    if(s.army < 8){ pushLog('You need at least 8 troops to raid.'); return; }
    var c = counts();
    var towerBonus = 1 + c.tower*0.05;
    var myPower = s.army * towerBonus * (0.8+Math.random()*0.4);
    var theirPower = s.rivalStr * (0.8+Math.random()*0.4);
    if(myPower > theirPower){
      var loot = Math.round(30+Math.random()*50);
      s.gold += loot;
      s.army = Math.max(0, s.army - Math.round(s.army*0.05));
      pushLog('Raid on Brannoch succeeded. Looted ' + loot + ' gold.');
    } else {
      var lost = Math.round(s.army*0.15);
      s.army = Math.max(0, s.army-lost);
      pushLog('The raid was repelled. Lost ' + lost + ' troops.');
    }
    s.allied = false;
    updateStats();
  });

  document.getElementById('act-spy').addEventListener('click', function(){
    pushLog("Spies report Brannoch's strength at " + Math.round(s.rivalStr) + '.');
  });

  document.getElementById('act-ally').addEventListener('click', function(){
    if(s.gold < 40){ pushLog('Not enough gold to offer tribute for an alliance.'); return; }
    s.gold -= 40;
    s.allied = true;
    pushLog('Brannoch accepts your alliance offer. Peace holds.');
    updateStats();
  });

  function advance(){
    var c = counts();
    var goldBonus = s.castleTier>=1 ? 1.1 : 1;
    var foodBonus = s.castleTier>=2 ? 1.1 : 1;
    var armyCapBonus = s.castleTier>=2 ? 20 : 0;

    var foodProd = c.farm * 22 * foodBonus;
    var popCap = c.house * 6;
    s.pop = Math.min(popCap, s.pop + Math.max(2, popCap*0.2));
    var foodEat = Math.round(s.pop * 0.8);
    s.food = Math.max(0, s.food + foodProd - foodEat);

    var goldIncome = Math.round((c.market * 18 + s.pop * 0.5) * goldBonus);
    var upkeep = c.farm*buildings.farm.upkeep + c.house*buildings.house.upkeep + c.market*buildings.market.upkeep + c.barracks*buildings.barracks.upkeep + c.tower*buildings.tower.upkeep;
    s.gold = Math.max(0, s.gold + goldIncome - upkeep);

    var armyCap = 10 + c.barracks*15 + armyCapBonus;
    s.army = Math.min(armyCap, s.army + (c.barracks>0 ? 3 : 0));

    if(!s.allied){
      s.rivalStr += Math.random()*3;
    } else if(Math.random() < 0.3){
      s.allied = false;
    }

    seasonalEvent();

    s.season += 1;
    updateStats();
    checkQuests();
    pushLog('Season ' + (s.season-1) + ': +' + goldIncome + 'g income, food ' + (Math.round(foodProd-foodEat) >= 0 ? '+' : '') + Math.round(foodProd-foodEat) + ', population ' + Math.round(s.pop) + '.');
  }

  function seasonalEvent(){
    var roll = Math.random();
    if(roll < 0.12){
      var g = Math.round(20+Math.random()*40);
      s.gold += g;
      pushLog('A traveling merchant paid handsomely to pass through. +' + g + 'g.');
    } else if(roll < 0.22){
      var f = Math.round(15+Math.random()*30);
      s.food = Math.max(0, s.food - f);
      pushLog('A harsh storm damaged the harvest. -' + f + ' food.');
    } else if(roll < 0.30){
      pushLog('A village festival lifted spirits across the kingdom.');
    } else if(roll < 0.36){
      var lost = Math.round(5+Math.random()*10);
      s.gold = Math.max(0, s.gold-lost);
      pushLog('A minor fire damaged storehouses. -' + lost + 'g in repairs.');
    }
  }

  document.getElementById('advance').addEventListener('click', advance);

  renderMap();
  updateStats();
  renderQuests();
  pushLog('Your kingdom takes root. Place a few buildings, then advance the season.');
})();
