(function() {
  var $ = function(s) { return document.querySelector(s); };
  
  var ls = {
    get: function(k) {
      try { return localStorage.getItem(k); } 
      catch (e) { return null; }
    },
    set: function(k, v) {
      try { localStorage.setItem(k, v); } 
      catch (e) {}
    }
  };
  
  var IV = [300, 350, 400, 450, 500, 550],
      iv = +ls.get('rl:iv') || 500,
      muted = ls.get('rl:mute') === '1';
      
  var runs = [],
      driver = null,
      db = null,
      state = 'idle',
      timers = [],
      greenT = 0,
      greenDue = 0,
      thirdAmberT = 0,
      stagedRtAnchors = null,
      startedAt = 0,
      doneAt = 0;
      
  var L = {};
  var rtBoundaryTolerance = 30;
  var sec = function(ms) { return (ms / 1000).toFixed(3); };

  /* --- Tree --- */
  function bulb(id, c, small) {
    var b = document.createElement('div');
    b.className = 'b' + (small ? ' s' : '');
    b.style.setProperty('--c', c);
    (L[id] = L[id] || []).push(b);
    return b;
  }

  (function() {
    var t = $('#tree');
    
    function row(id, c, n, s) {
      var r = document.createElement('div');
      r.className = 'row' + (id === 'a3' || id === 'g' ? ' rt-row' : '');
      var lamps = document.createElement('div');
      lamps.className = 'lamps';
      for (var i = 0; i < n; i++) lamps.appendChild(bulb(id, c, s));
      r.appendChild(lamps);
      if (id === 'a3' || id === 'g') {
        var anchor = document.createElement('label');
        anchor.className = 'rt-anchor';
        var label = document.createElement('span');
        label.textContent = id === 'a3' ? '3rd Light RT (s)' : 'Green Light RT (s)';
        anchor.appendChild(label);

        var input = document.createElement('input');
        input.id = id === 'a3' ? 'rt-a3' : 'rt-green';
        input.type = 'number';
        input.min = '0';
        input.max = '1';
        input.step = '0.001';
        input.placeholder = '0.000';
        input.required = true;
        input.setAttribute('aria-label', label.textContent);
        input.addEventListener('input', function() {
          if (this.value !== '' && (!Number.isFinite(this.valueAsNumber) ||
              this.valueAsNumber < 0 || this.valueAsNumber > 1)) {
            msg('Angka RT harus diantara 0.000 hingga 1.000!.', true, '#e5383b');
          }
        }); 
        anchor.appendChild(input);
        r.appendChild(anchor);
      }
      t.appendChild(r);
    }
    
    row('pre', '#fff', 2, 1);
    
    // Menambahkan tulisan STAGE
    var stageText = document.createElement('div');
    stageText.className = 'stage-text';
    stageText.textContent = 'STAGE';
    t.appendChild(stageText);
    
    row('stg', '#fff', 2, 1);
    
    var g = document.createElement('div');
    g.className = 'gap';
    t.appendChild(g);
    
    row('a1', '#ffb300', 1);
    row('a2', '#ffb300', 1);
    row('a3', '#ffb300', 1);
    row('g', '#22e56f', 1);
    row('r', '#ff3b30', 1);
  })();

  function lit(id, on) {
    L[id].forEach(function(b) { b.classList.toggle('on', on); });
  }

  function allOff() {
    for (var k in L) lit(k, false);
  }

  /* --- Audio --- */
  var AC, rv = null;
  
  function ac() {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    return AC;
  }
  
  function tone(f, d, type, v) {
    if (muted) return;
    try {
      var a = ac(),
          o = a.createOscillator(),
          g = a.createGain();
          
      o.type = type || 'square';
      o.frequency.value = f;
      g.gain.setValueAtTime(v || .07, a.currentTime);
      g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + d);
      
      o.connect(g);
      g.connect(a.destination);
      o.start();
      o.stop(a.currentTime + d);
    } catch (e) {}
  }
  
  function revStart(s) {
    if (muted) return;
    try {
      var a = ac(),
          o = a.createOscillator(),
          g = a.createGain(),
          f = a.createBiquadFilter();
          
      o.type = 'sawtooth';
      f.type = 'lowpass';
      f.frequency.value = 520;
      
      o.frequency.setValueAtTime(60, a.currentTime);
      o.frequency.exponentialRampToValueAtTime(200, a.currentTime + s);
      g.gain.value = .06;
      
      o.connect(f);
      f.connect(g);
      g.connect(a.destination);
      o.start();
      
      rv = { o: o, g: g, a: a };
    } catch (e) {}
  }
  
  function revStop() {
    if (!rv) return;
    var r = rv;
    rv = null;
    r.g.gain.setTargetAtTime(.0001, r.a.currentTime, .07);
    r.o.stop(r.a.currentTime + .4);
  }

  /* --- Run Logic --- */
  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function clearT() { timers.forEach(clearTimeout); timers = []; }
  function msg(t, isError) {
    var message = $('#msg');
    message.textContent = t;
    message.classList.toggle('error', !!isError);
  }
  
  function readout(t, c) {
    var r = $('#read');
    r.textContent = t;
    r.className = 'read ' + c;
  }
  
  function padText(t, go) {
    var p = $('#pad');
    p.textContent = t;
    p.classList.toggle('go', !!go);
  }

  function readRtAnchors() {
    var third = $('#rt-a3').value.trim(),
        fourth = $('#rt-green').value.trim();
    if (!third || !fourth) {
      return { error: 'Harus masukan angka RT antara 0.000 hingga 1.000' };
    }

    var thirdMs = Number(third) * 1000,
        fourthMs = Number(fourth) * 1000;
    if (!Number.isFinite(thirdMs) || !Number.isFinite(fourthMs) ||
        thirdMs < 0 || thirdMs > 1000 || fourthMs < 0 || fourthMs > 1000) {
      return { error: 'Angka RT harus diantara 0.000 hingga 1.000' };
    }
    if (fourthMs <= thirdMs) {
      return { error: 'RT Lampu Hijau harus lebih tinggi dari RT Lampu Ke-3!' };
    }
    return { third: thirdMs, fourth: fourthMs };
  }

  function start() {
    if (!driver) {
      msg('Masukin Jenis Mobil dan Nama Joki dulu ya...');
      $('#name').focus();
      return;
    }

    var anchors = readRtAnchors();
    if (anchors.error) {
      msg(anchors.error, true);
      if (!$('#rt-a3').value.trim()) $('#rt-a3').focus();
      else if (!$('#rt-green').value.trim()) $('#rt-green').focus();
      else if (Number($('#rt-a3').value) < 0 || Number($('#rt-a3').value) > 1) $('#rt-a3').focus();
      else if (Number($('#rt-green').value) < 0 || Number($('#rt-green').value) > 1) $('#rt-green').focus();
      else $('#rt-green').focus();
      return;
    }
    stagedRtAnchors = anchors;
    
    clearT();
    revStop();
    allOff();
    
    state = 'staged';
    greenT = 0;
    thirdAmberT = 0;
    startedAt = performance.now();
    
    lit('pre', true);
    tone(520, .1);
    
    at(180, function() {
      lit('stg', true);
      tone(520, .1);
    });
    
    readout('0.000', 'idle');
    msg('Staged. Tunggu warna hijau.');
    padText('Gas', 1);
    
    var d = 1000 + Math.random() * 1300;
    greenDue = startedAt + d + iv * 3;
    
    at(d, function() {
      lit('a1', true);
      tone(700, .14);
      revStart(iv * 3 / 1000 + .15);
    });
    
    at(d + iv, function() {
      lit('a2', true);
      tone(700, .14);
    });
    
    at(d + iv * 2, function() {
      thirdAmberT = performance.now();
      lit('a3', true);
      tone(700, .14);
    });
    
    at(d + iv * 3, function() {
      greenT = performance.now();
      lit('g', true);
      revStop();
      tone(1250, .35, 'sine', .12);
    });
    
    at(d + iv * 3 + 2000, function() {
      if (state === 'staged') {
        state = 'done';
        doneAt = performance.now();
        msg('Gagal meluncur, coba lagi.');
        padText('Stage lagi');
      }
    });
  }

  function press(eventTime) {
    var currentTime = performance.now(),
        now = typeof eventTime === 'number' && Math.abs(eventTime - currentTime) < 60000 ?
          eventTime : currentTime;
    
    if (state === 'idle' || state === 'done') {
      if (now - doneAt > 400) start();
      return;
    }
    
    if (now - startedAt < 250) return;
    
    clearT();
    revStop();
    state = 'done';
    doneAt = now;
    padText('Stage lagi');
    
    var anchors = stagedRtAnchors,
        calibrationEnd = greenT || greenDue,
        inCalibrationWindow = now >= thirdAmberT - rtBoundaryTolerance &&
          thirdAmberT > 0 && now <= calibrationEnd + rtBoundaryTolerance;

    if (!inCalibrationWindow && now < calibrationEnd) {
      var redRt = Math.round(now - greenDue);
      lit('r', true);
      tone(170, .5, 'sawtooth', .09);
      readout(sec(redRt), 'bad');
      msg('Jump start! -' + sec(Math.abs(redRt)) + ' s ');
      log({ red: true, rt: redRt });
    } else {
      var rt;
      if (inCalibrationWindow) {
        var progress = Math.max(0, Math.min(1, (now - thirdAmberT) / (calibrationEnd - thirdAmberT)));
        if (Math.abs(now - thirdAmberT) <= rtBoundaryTolerance) progress = 0;
        else if (Math.abs(now - calibrationEnd) <= rtBoundaryTolerance) progress = 1;
        rt = Math.round(anchors.third + progress * (anchors.fourth - anchors.third));
      } else {
        rt = Math.round(anchors.fourth + now - calibrationEnd);
      }
      var v = runs.filter(function(r) { return !r.red && r.iv === iv; });
      var pb = v.length ? Math.min.apply(null, v.map(function(r) { return r.rt; })) : 1e9;
      
      readout(sec(rt), 'ok');
      msg(
        rt < pb ? 'Anjay rekor baru!' : 
        rt <= 0 ? 'Sangar!' : 
        rt <= 100 ? 'Wih!' : 
        rt <= 200 ? 'Boleh-boleh.' : 
        'Kelamaan.'
      );
      
      log({ rt: rt });
    }

  }

  function log(r) {
    r.iv = iv;
    r.at = Date.now();
    r.carModel = driver.carModel;
    r.driverName = driver.name;
    runs.push(r);
    
    if (runs.length > 300) runs = runs.slice(-300);
    
    render();
    save();
  }

  /* --- Delete --- */
  function delRun(i) {
    runs.splice(i, 1);
    render();
    save();
  }
  
  var armT = null;
  
  $('#clear').onclick = function() {
    var b = this;
    if (!b.classList.contains('armed')) {
      b.classList.add('armed');
      b.textContent = 'Click again to confirm';
      armT = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    runs = [];
    render();
    save();
  };
  
  function disarm() {
    clearTimeout(armT);
    var b = $('#clear');
    b.classList.remove('armed');
    b.textContent = 'Clear all runs';
  }

  /* --- Stats and Results --- */
  function render() {
    $('#clear').disabled = !runs.length;
    
    var selectedEntries = runs.map(function(r, i) { return { run: r, index: i }; })
          .filter(function(entry) { return historyIv === 'all' || String(entry.run.iv) === historyIv; }),
        selectedRuns = selectedEntries.map(function(entry) { return entry.run; }),
        v = selectedRuns.filter(function(r) { return !r.red; }),
        l = v.slice(-10),
        n = l.length,
        pb = v.length ? Math.min.apply(null, v.map(function(r) { return r.rt; })) : null;
        
    var avg = n ? l.reduce(function(a, r) { return a + r.rt; }, 0) / n : null;
    var sd = n > 1 ? Math.sqrt(l.reduce(function(a, r) { return a + Math.pow(r.rt - avg, 2); }, 0) / n) : null;
    
    $('#pb').textContent = pb == null ? '0' : sec(pb);
    $('#avg').textContent = avg == null ? '0' : sec(avg);
    $('#sd').textContent = sd == null ? '0' : Math.round(sd);
    
    var red = selectedRuns.length - v.length;
    $('#cnt').textContent = selectedRuns.length;
    $('#rl').textContent = 'Runs, ' + red + ' red light' + (red === 1 ? '' : 's');
    
    var bars = $('#bars');
    bars.innerHTML = '';
    
    selectedRuns.slice(-20).forEach(function(r) {
      var d = document.createElement('div');
      if (r.red) {
        d.className = 'rl';
        d.style.height = '100%';
        d.title = 'red light!';
      } else {
        d.style.height = Math.max(4, Math.min(r.rt, 600) / 6) + '%';
        d.title = sec(r.rt) + ' s';
        if (r.rt === pb) d.className = 'pb';
      }
      bars.appendChild(d);
    });
    
    var h = $('#hist');
    h.innerHTML = '';
    
    if (!selectedEntries.length) {
      h.innerHTML = '<tr><td colspan="6" class="empty">' + (runs.length ? 'No runs for this amber interval.' : 'No runs yet.') + '</td></tr>';
      return;
    }
    
    selectedEntries.slice().reverse().forEach(function(entry) {
      var r = entry.run;
      var tr = document.createElement('tr');
      var values = [
        entry.index + 1,
        r.carModel || '-',
        r.driverName || '-',
        (r.iv / 1000).toFixed(2) + ' s',
        r.red ? 'JS!' + (typeof r.rt === 'number' ? ' (' + sec(r.rt) + ' s)' : '') : sec(r.rt) + ' s' + (r.rt === pb ? ' (best)' : '')
      ];
      values.forEach(function(value, index) {
        var td = document.createElement('td');
        td.textContent = value;
        if (index === 4 && r.red) td.style.color = 'var(--red)';
        tr.appendChild(td);
      });
      
      var idx = entry.index,
          td = document.createElement('td'),
          x = document.createElement('button');
          
      x.className = 'del';
      x.textContent = 'Delete';
      x.setAttribute('aria-label', 'Delete run ' + (idx + 1));
      x.onclick = function() { delRun(idx); };
      
      td.appendChild(x);
      tr.appendChild(td);
      h.appendChild(tr);
    });
  }

  /* --- Storage --- */
  function slug(n) {
    return n.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  }
  
  function status(t) { $('#save').textContent = t; }
  
  var saving = false, again = false;
  
  async function save() {
    if (!driver) return;
    
    var doc = { name: driver.name, carModel: driver.carModel, runs: runs, updated: Date.now() };
    ls.set('rl:d:' + driver.slug, JSON.stringify(doc));
    
    if (!db) {
      status('Hasil hanya tersimpan pada perangkat ini');
      return;
    }
    if (saving) {
      again = true;
      return;
    }
    
    saving = true;
    try {
      await db.doc('drivers/' + driver.slug).set(doc);
      status('Tersminpan pada server');
    } catch (e) {
      status('Hasil hanya tersimpan pada perangkat ini');
    }
    
    saving = false;
    if (again) {
      again = false;
      save();
    }
  }
  
  async function loadDriver(name, carModel) {
    name = name.trim();
    carModel = carModel.trim();
    if (carModel.length < 3 || carModel.length > 20) {
      msg('Jenis Mobil harus minimal 3 huruf.', true, '#e5383b');
      $('#car');
      return;
    }
    if (name.length < 3 || name.length > 20) {
      msg('Nama Joki harus minimal 3 huruf.', true);
      $('#name');
      return;
    }
    var s = slug(name);
    
    if (!s) {
      msg('Belum ada joki.', true);
      return;
    }
    
    clearT();
    revStop();
    allOff();
    state = 'idle';
    status('Memuat...');
    
    var data = null;
    
    if (db) {
      try {
        var snap = await db.doc('drivers/' + s).get();
        var d = snap && snap.data ? snap.data() : null;
        if (d && d.runs) data = d;
      } catch (e) {}
    }
    
    if (!data) {
      try {
        var raw = ls.get('rl:d:' + s);
        if (raw) data = JSON.parse(raw);
      } catch (e) {}
    }
    
    driver = { name: name, carModel: carModel, slug: s };
    runs = data && Array.isArray(data.runs) ? data.runs : [];

    render();
    readout('0.000s', 'idle');
    padText('Stage');
    
    status(db ? 'Driver loaded. Runs save to the server' : 'Joki sudah masuk.');
    msg('Siap, ' + name + '. Tekan tombol STAGE kalau sudah siap.');
  }

  /* --- Controls --- */
  var opts = $('#opts');
  var historyIv = 'all',
      historyInterval = $('#history-interval');

  IV.forEach(function(ms) {
    var option = document.createElement('option');
    option.value = ms;
    option.textContent = (ms / 1000).toFixed(2) + ' s';
    historyInterval.appendChild(option);
  });

  historyInterval.onchange = function() {
    historyIv = this.value;
    render();
  };
  
  IV.forEach(function(ms) {
    var b = document.createElement('button');
    b.textContent = (ms / 1000).toFixed(2) + 's';
    b.setAttribute('aria-pressed', ms === iv);
    
    b.onclick = function() {
      if (state === 'staged') return;
      iv = ms;
      ls.set('rl:iv', ms);
      [].forEach.call(opts.children, function(x) {
        x.setAttribute('aria-pressed', x === b);
      });
      render();
    };
    opts.appendChild(b);
  });
  
  function muteUI() {
    var m = $('#mute');
    m.textContent = muted ? 'Sound off' : 'Sound on';
    m.setAttribute('aria-pressed', muted);
  }
  
  $('#mute').onclick = function() {
    muted = !muted;
    ls.set('rl:mute', muted ? '1' : '0');
    if (muted) revStop();
    muteUI();
  };
  muteUI();
  
  $('#load').onclick = function() { loadDriver($('#name').value, $('#car').value); };
  
  $('#name').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') loadDriver(this.value, $('#car').value);
  });

  $('#car').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') loadDriver($('#name').value, this.value);
  });
  
  $('#pad').addEventListener('pointerdown', function(e) {
    e.preventDefault();
    press(e.timeStamp);
  });
  
  document.addEventListener('keydown', function(e) {
    if ((e.code === 'Space' || e.code === 'Enter') && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      if (!e.repeat) press(e.timeStamp);
    }
  });
  
  document.addEventListener('keyup', function(e) {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') e.preventDefault();
  });

  /* --- Start Up --- */
  Array.prototype.forEach.call(document.querySelectorAll('input'), function(input) {
    input.value = '';
  });

  (async function() {
    for (var i = 0; i < 12 && !window.claude; i++) {
      await new Promise(function(r) { setTimeout(r, 250); });
    }
    
    try {
      db = window.claude ? await window.claude.use('db') : null;
    } catch (e) {
      db = null;
    }
  })();
  
  render();
})();