import { $, $$, el, icon, siteIcon } from './shared.js';
import {
  formatSeconds,
  newDomains,
  providerLabel,
  providerShort,
  searchProgress,
  searchStep
} from './ui-helpers.js';

const MOTE_COUNT = 10;
const MAX_DOMAIN_CHIPS = 7;

export function createSearchAnimation({ now = () => performance.now() } = {}) {
  const stage = $('#search-stage');
  const nodesLayer = $('#radar-nodes');
  const motesLayer = $('#radar-motes');
  const core = $('.radar-core', stage);
  const title = $('.shimmer-text', stage);
  const queryLine = $('#stage-query');
  const foundValue = $('#stage-found');
  const sourcesValue = $('#stage-sources');
  const timeValue = $('#stage-time');
  const domainsBox = $('#stage-domains');
  const bar = $('#stage-bar');
  const status = $('#stage-status');
  const steps = $$('#stage-steps li');

  let run = null;
  let clock = null;
  let barTimer = null;
  let countFrame = 0;
  let leaveTimer = null;

  function reducedMotion() {
    return document.documentElement.dataset.motion === 'reduced';
  }

  function stopTimers() {
    clearInterval(clock);
    clearInterval(barTimer);
    cancelAnimationFrame(countFrame);
    clock = null;
    barTimer = null;
  }

  function setBar(percent) {
    const value = Math.max(run?.percent || 0, Math.min(100, percent));
    if (run) run.percent = value;
    bar.style.width = `${value}%`;
    window.dispatchEvent(new CustomEvent('nova:search-progress', { detail: { percent: value } }));
  }

  function setStep(current) {
    steps.forEach((item, index) => {
      const number = index + 1;
      item.classList.toggle('done', number < current);
      item.classList.toggle('active', number === current);
    });
    if (run && run.step !== current) {
      run.step = current;
      const label = $('.step-label', steps[current - 1])?.textContent || '';
      status.textContent = label;
    }
  }

  function setStepDetail(number, text) {
    const detail = $('.step-detail', steps[number - 1]);
    if (detail) detail.textContent = text;
  }

  function updateSources() {
    sourcesValue.textContent = `${run.done.size}/${run.total}`;
  }

  function countTo(target) {
    cancelAnimationFrame(countFrame);
    const from = run.shown;
    run.target = target;
    if (reducedMotion() || from === target) {
      run.shown = target;
      foundValue.textContent = String(target);
      return;
    }
    const start = now();
    const duration = 650;
    const tick = () => {
      const progress = Math.min(1, (now() - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      run.shown = Math.round(from + (target - from) * eased);
      foundValue.textContent = String(run.shown);
      if (progress < 1) countFrame = requestAnimationFrame(tick);
    };
    countFrame = requestAnimationFrame(tick);
  }

  function addNode(name, index, total, { index: isIndex = false, documents = 0 } = {}) {
    const angle = total === 1 ? -90 : -90 + (360 / total) * index;
    const label = isIndex ? 'Nova index' : providerLabel(name);
    const beam = el('span', { class: 'beam', dataset: { for: name } });
    beam.style.setProperty('--a', `${angle}deg`);
    const badge = el('span', { class: 'node-badge' }, icon('check'));
    const count = el('span', { class: 'node-count', text: isIndex ? `${documents}` : '' });
    const chip = el(
      'span',
      { class: 'node-chip' },
      document.createTextNode(isIndex ? 'Ix' : providerShort(name)),
      badge,
      count
    );
    chip.style.setProperty('--delay', `${(index * -0.6).toFixed(1)}s`);
    const node = el(
      'div',
      {
        class: `node ${isIndex ? 'done' : 'waiting'}`,
        title: label,
        dataset: { provider: name }
      },
      chip
    );
    node.style.setProperty('--a', `${angle}deg`);
    nodesLayer.append(beam, node);
    if (isIndex) beam.classList.add('done');
    return { node, beam, count, angle };
  }

  function buildMotes() {
    motesLayer.replaceChildren();
    for (let i = 0; i < MOTE_COUNT; i++) {
      const mote = el('span', { class: 'mote' });
      mote.style.setProperty('--a', `${Math.round((360 / MOTE_COUNT) * i + (i % 3) * 7)}deg`);
      mote.style.setProperty('--delay', `${(i * 0.28).toFixed(2)}s`);
      motesLayer.append(mote);
    }
  }

  function firePacket(angle) {
    if (reducedMotion()) return;
    const packet = el('span', { class: 'packet' });
    packet.style.setProperty('--a', `${angle}deg`);
    nodesLayer.append(packet);
    const remove = () => packet.remove();
    packet.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 1400);
    core.classList.remove('received');
    void core.offsetWidth;
    core.classList.add('received');
  }

  core.addEventListener('animationend', (event) => {
    if (event.animationName === 'core-hit') core.classList.remove('received');
  });

  function addDomains(results) {
    for (const host of newDomains(results, run.domains, 4)) {
      const chip = el('span', { class: 'domain-chip' }, siteIcon({ host, variant: '' }), host);
      domainsBox.prepend(chip);
      while (domainsBox.children.length > MAX_DOMAIN_CHIPS) domainsBox.lastElementChild.remove();
    }
  }

  function reset() {
    stopTimers();
    clearTimeout(leaveTimer);
    run = null;
    stage.classList.remove('leaving', 'done', 'failed');
    nodesLayer.replaceChildren();
    motesLayer.replaceChildren();
    domainsBox.replaceChildren();
    steps.forEach((item) => {
      item.classList.remove('active', 'done');
      setStepDetailFor(item, '');
    });
    foundValue.textContent = '0';
    sourcesValue.textContent = '0/0';
    timeValue.textContent = '0.0 s';
    bar.style.width = '0%';
    title.textContent = 'Searching the web';
  }

  function setStepDetailFor(item, text) {
    const detail = $('.step-detail', item);
    if (detail) detail.textContent = text;
  }

  function start({ query, providers = [], indexDocuments = 0 }) {
    reset();
    const names = [...providers];
    const total = names.length;
    run = {
      total,
      done: new Set(),
      nodes: new Map(),
      domains: new Set(),
      begin: now(),
      percent: 0,
      shown: 0,
      target: 0,
      step: 0
    };
    stage.hidden = false;
    stage.setAttribute('aria-busy', 'true');
    queryLine.textContent = `“${query}”`;
    buildMotes();
    const hasIndex = indexDocuments > 0;
    const slots = total + (hasIndex ? 1 : 0);
    names.forEach((name, index) => run.nodes.set(name, addNode(name, index, Math.max(slots, 1))));
    if (hasIndex) addNode('omni-index', total, slots, { index: true, documents: indexDocuments });
    updateSources();
    setStep(1);
    setStepDetail(1, total ? `${total} source${total === 1 ? '' : 's'}` : 'local index');
    setBar(searchProgress({ stage: 'start', total }));
    clock = setInterval(() => {
      timeValue.textContent = formatSeconds(now() - run.begin);
    }, 100);
    barTimer = setInterval(() => {
      if (run && run.percent < 88) setBar(run.percent + (90 - run.percent) * 0.035);
    }, 400);
    if (!total) {
      setStep(3);
      setBar(searchProgress({ stage: 'ranking' }));
    }
  }

  function provider(progress) {
    if (!run || run.finished) return;
    const entry = run.nodes.get(progress.provider);
    const finished = progress.ok || !progress.skipped;
    if (entry) {
      entry.node.classList.remove('waiting');
      if (progress.ok) {
        entry.node.classList.add('done');
        entry.beam.classList.add('done');
        entry.count.textContent = String(progress.resultCount ?? 0);
        firePacket(entry.angle);
      } else if (progress.skipped) {
        entry.node.classList.add('skipped');
        entry.beam.classList.add('skipped');
      } else {
        entry.node.classList.add('failed');
        entry.beam.classList.add('failed');
        entry.node.querySelector('.node-badge').replaceChildren(document.createTextNode('!'));
      }
    }
    if (finished || progress.skipped) run.done.add(progress.provider);
    updateSources();
    const results = progress.results || [];
    if (results.length) {
      countTo(results.length);
      addDomains(results);
    }
    const state = { stage: 'provider', done: run.done.size, total: run.total };
    const step = searchStep(state);
    setStep(step);
    setStepDetail(1, `${run.done.size} of ${run.total} answered`);
    if (step >= 2) setStepDetail(2, `${run.shown || results.length} pages`);
    setBar(searchProgress(state));
    if (run.done.size >= run.total) ranking();
  }

  function ranking() {
    if (!run || run.ranking) return;
    run.ranking = true;
    setStep(3);
    setBar(searchProgress({ stage: 'ranking' }));
    setStepDetail(3, 'almost there');
  }

  function finish({ total = 0, tookMs = 0 } = {}) {
    if (!run || run.finished) return;
    run.finished = true;
    stopTimers();
    steps.forEach((item) => {
      item.classList.remove('active');
      item.classList.add('done');
    });
    setStepDetail(4, 'done');
    countTo(total);
    timeValue.textContent = formatSeconds(tookMs || now() - run.begin);
    setBar(searchProgress({ stage: 'finished' }));
    title.textContent = total
      ? `Found ${total} result${total === 1 ? '' : 's'}`
      : 'Search finished';
    status.textContent = title.textContent;
    stage.classList.add('done');
    stage.setAttribute('aria-busy', 'false');
    const delay = reducedMotion() ? 0 : 520;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      stage.classList.add('leaving');
      leaveTimer = setTimeout(
        () => {
          stage.hidden = true;
          stage.classList.remove('leaving');
        },
        reducedMotion() ? 0 : 520
      );
    }, delay);
  }

  function fail() {
    if (!run || run.finished) return;
    run.finished = true;
    stopTimers();
    title.textContent = 'Search interrupted';
    status.textContent = title.textContent;
    stage.classList.add('failed');
    stage.setAttribute('aria-busy', 'false');
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(
      () => {
        stage.hidden = true;
        stage.classList.remove('failed');
      },
      reducedMotion() ? 0 : 900
    );
  }

  function cancel() {
    reset();
    stage.hidden = true;
    stage.setAttribute('aria-busy', 'false');
  }

  return {
    start,
    provider,
    ranking,
    finish,
    fail,
    cancel,
    isRunning: () => Boolean(run) && !run.finished
  };
}
