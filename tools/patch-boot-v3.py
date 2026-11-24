# -*- coding: utf-8 -*-
"""把 boot.js 的滚动视图层替换成标签页视图层。只执行一次。"""
import io, sys

p = 'js/boot.js'
lines = io.open(p, encoding='utf-8').read().split('\n')

start = next(i for i, l in enumerate(lines) if l.strip() == 'measureLayout();')
# 向上找到 applySize 的结尾：start-1 应为 '}'；start-2 空行
end = next(i for i, l in enumerate(lines[start:], start) if 'function updateView()' in l)
# updateView 结束：从 end 起找第一个行首 '  }'
end2 = next(i for i, l in enumerate(lines[end:], end) if l == '  }')

new = r'''  }

  /* ============================================================
   * 章节（标签页）状态
   * ============================================================ */
  function collectSections() {
    sections = Array.prototype.slice.call(document.querySelectorAll('#scroll .chapter'));
    for (let i = 0; i < sections.length; i++) {
      if (sectionP[i] === undefined) sectionP[i] = 0;
      if (sectionO[i] === undefined) sectionO[i] = 0;
      if (lastP[i] === undefined) lastP[i] = -1;
      if (lastO[i] === undefined) lastO[i] = -1;
    }
  }

  function hashIndex() {
    const hash = (location.hash || '').replace(/^#/, '');
    if (!hash) return 0;
    const el = document.getElementById(hash) || document.getElementById('ch-' + hash);
    const i = sections.indexOf(el);
    return i > 0 ? i : 0;
  }

  function isFlowChapter(i) {
    const s = sections[i];
    return !!(s && s.classList.contains('is-flow'));
  }

  function updateProgress() {
    if (!sections.length) return;
    const now = performance.now();
    const dwell = reduceMotion ? 1 : clamp((now - activeAt) / 2000, 0, 1);
    const e = 1 - Math.pow(1 - dwell, 3);

    // 入场推镜：p 从 0.10 推到 0.86；flow 章节再叠加内部滚动，让画面跟着内容走
    let p = 0.10 + 0.76 * e;
    const sec = sections[activeIndex];
    if (sec && sec.classList.contains('is-flow')) {
      const max = Math.max(1, sec.scrollHeight - sec.clientHeight);
      const frac = clamp((sec.scrollTop || 0) / max, 0, 1);
      p = 0.16 + 0.70 * e + frac * 0.14;
    }
    sectionP[activeIndex] = clamp(p, 0, 1);
    sectionO[activeIndex] = clamp((now - activeAt) / 360, 0, 1);

    for (let i = 0; i < sections.length; i++) {
      if (i !== activeIndex) { sectionP[i] = 0; sectionO[i] = 0; }
      const po = sectionP[i], oo = sectionO[i];
      if (Math.abs(po - lastP[i]) > 0.0008 || Math.abs(oo - lastO[i]) > 0.004) {
        lastP[i] = po;
        lastO[i] = oo;
        const st = sections[i].style;
        st.setProperty('--p', po.toFixed(4));
        st.setProperty('--o', oo.toFixed(4));
      }
    }

    // 鼠标平滑（部分场景读 COSMOS.input，这里保留旧的平滑值供兼容）
    mouseX += (mouseTX - mouseX) * 0.06;
    mouseY += (mouseTY - mouseY) * 0.06;
  }

  /* ============================================================
   * 幕布转场（四色斜向条纹，参照学习中心）
   * ============================================================ */
  function playCurtain(inOut) {
    const el = $('curtain');
    if (!el || reduceMotion) return;
    if (inOut === 'in') {
      el.classList.add('on', 'in');
      el.classList.remove('out');
    } else {
      el.classList.remove('in');
      el.classList.add('on', 'out');
      clearTimeout(curtainTimer2);
      curtainTimer2 = setTimeout(function () {
        el.classList.remove('on', 'out');
      }, 560);
    }
  }

  function commitTab(i) {
    if (i === activeIndex) { transitionEnd(); return; }
    const leaving = stages[activeIndex];
    if (leaving && typeof leaving.leave === 'function') {
      try { leaving.leave(); } catch (e) { reportError('leave#' + activeIndex, e); }
    }
    activeIndex = i;
    activeAt = performance.now();
    prevActiveIndex = -1;

    // flow 章节回到顶部
    const sec = sections[activeIndex];
    if (sec && sec.scrollTop) sec.scrollTop = 0;

    ensureAround(activeIndex);
    const entering = stages[activeIndex];
    if (entering && typeof entering.enter === 'function') {
      try { entering.enter(); } catch (e) { reportError('enter#' + activeIndex, e); }
    }
    try {
      if (sec && sec.id) history.replaceState(null, '', '#' + sec.id);
    } catch (e) { /* file:// 忽略 */ }

    playCurtain('out');
    transitionEnd();
  }

  function transitionEnd() {
    transitioning = false;
    // 转场期间用户又点了别的标签：等幕布完全撤走再补一次
    if (pendingTarget >= 0) {
      const t = pendingTarget;
      pendingTarget = -1;
      tabGo(t);
    }
  }

  function tabGo(i, instant) {
    if (!sections.length) return;
    if (typeof i === 'string') {
      const el = document.getElementById(i) || document.getElementById('ch-' + i);
      if (!el) {
        const n = parseInt(i, 10);
        if (isNaN(n)) return;
        i = n;
      } else {
        i = sections.indexOf(el);
      }
    }
    i = clamp(Math.round(i), 0, sections.length - 1);

    if (instant || reduceMotion) {
      const leaving = stages[activeIndex];
      if (leaving && typeof leaving.leave === 'function') {
        try { leaving.leave(); } catch (e) { reportError('leave#instant', e); }
      }
      activeIndex = i;
      activeAt = performance.now() - 10000;
      ensureAround(activeIndex);
      const entering = stages[activeIndex];
      if (entering && typeof entering.enter === 'function') {
        try { entering.enter(); } catch (e) { reportError('enter#instant', e); }
      }
      try {
        if (sections[i] && sections[i].id) history.replaceState(null, '', '#' + sections[i].id);
      } catch (e) { /* ignore */ }
      updateProgress();
      renderFrame();
      return;
    }

    if (transitioning) { pendingTarget = i; return; }
    if (i === activeIndex) return;

    transitioning = true;
    playCurtain('in');
    clearTimeout(curtainTimer);
    // 幕布完全盖住屏幕后再切换场景，换完再从另一侧揭开
    curtainTimer = setTimeout(function () { commitTab(i); }, reduceMotion ? 0 : 430);
  }'''

lines[start-1:end2+1] = new.split('\n')
io.open(p, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print('patched lines', start, end2)
