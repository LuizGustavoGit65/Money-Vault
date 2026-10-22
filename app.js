(() => {
  'use strict';

  const STORAGE_KEY = 'moneyVault.personal.v2';
  const COLORS = {
    Moradia: ['#6f9be8', 'rgba(111, 155, 232, 0.12)', 'M'],
    Alimentação: ['#efb854', 'rgba(239, 184, 84, 0.12)', 'A'],
    Transporte: ['#9bd8ba', 'rgba(155, 216, 186, 0.12)', 'T'],
    Saúde: ['#e77f66', 'rgba(231, 127, 102, 0.12)', 'S'],
    Lazer: ['#a08de0', 'rgba(160, 141, 224, 0.12)', 'L'],
    Educação: ['#c9e978', 'rgba(201, 233, 120, 0.12)', 'E'],
    Outros: ['#93939c', 'rgba(147, 147, 156, 0.12)', 'O'],
    Salário: ['#b7e36b', 'rgba(183, 227, 107, 0.12)', 'R'],
    Extra: ['#6f9be8', 'rgba(111, 155, 232, 0.12)', 'R']
  };

  const today = new Date();
  const monthId = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const currentMonth = monthId(today);
  const localISODate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const id = () => (window.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
  const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
  const shortMonthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'short' });
  const percentFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const emptyData = () => ({ transactions: [], budgets: [], goals: [] });

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyData();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.transactions) || !Array.isArray(parsed.budgets) || !Array.isArray(parsed.goals)) {
        return emptyData();
      }
      const fictionalDescriptions = new Set([
        'Spotify Technology', 'Amazon.com Inc', 'Microsoft Corporation',
        'NVIDIA Corporation', 'Apple Inc Portfolio Inflow', 'Dividendos & Rendimentos'
      ]);
      const fictionalGoals = new Set([
        'Carteira Global de Ações', 'Reserva de Emergência High-Yield', 'Aporte Tecnologias & IA'
      ]);
      const containsDemoData = parsed.transactions.some((item) => fictionalDescriptions.has(item.description)) || parsed.goals.some((item) => fictionalGoals.has(item.name));
      parsed.transactions = parsed.transactions.filter((item) => !fictionalDescriptions.has(item.description));
      if (containsDemoData) {
        const demoBudgets = { 'Moradia': 3500, 'AlimentaÃ§Ã£o': 2500, 'Transporte': 1800, 'Lazer': 1500, 'SaÃºde': 1000, 'EducaÃ§Ã£o': 800 };
        parsed.budgets = parsed.budgets.filter((item) => demoBudgets[item.category] !== Number(item.limit));
      }
      parsed.goals = parsed.goals.filter((item) => !fictionalGoals.has(item.name));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      return parsed;
    } catch {
      return emptyData();
    }
  }

  let data = loadData();
  let view = 'overview';
  let selectedMonth = currentMonth;
  let searchTerm = '';
  let categoryFilter = 'all';
  let chartPeriod = '30d';
  let chartMetric = 'balance';
  let toastTimer;

  const viewRoot = document.querySelector('#view-container');
  const dialog = document.querySelector('#transaction-dialog');
  const form = document.querySelector('#transaction-form');

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      syncTransactions();
      return true;
    } catch {
      showToast('Não foi possível salvar no navegador. Confira o espaço disponível.');
      return false;
    }
  }

  let transactionSyncInProgress = false;
  let transactionSyncPaused = false;

  async function syncTransactions() {
    if (transactionSyncInProgress || transactionSyncPaused) return;
    transactionSyncInProgress = true;
    try {
      const currentResponse = await fetch('/api/transactions');
      if (!currentResponse.ok) return;
      const currentPayload = await currentResponse.json();
      const remoteTransactions = Array.isArray(currentPayload.transactions) ? currentPayload.transactions : [];
      const remoteIds = new Set(remoteTransactions.map((item) => item.id));
      const localOnly = data.transactions.filter((item) => !remoteIds.has(item.id));

      if (localOnly.length) {
        await fetch('/api/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(localOnly)
        });
      }

      const latestResponse = await fetch('/api/transactions');
      if (!latestResponse.ok) return;
      const latestPayload = await latestResponse.json();
      const merged = new Map(data.transactions.map((item) => [item.id, item]));
      (latestPayload.transactions || []).forEach((item) => {
        if (!merged.has(item.id)) merged.set(item.id, item);
      });
      if (merged.size !== data.transactions.length) {
        data.transactions = [...merged.values()];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        populateMonths();
        render();
      }
    } catch {
      // The dashboard remains usable from localStorage while the API is offline.
    } finally {
      transactionSyncInProgress = false;
    }
  }

  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const categoryStyle = (category) => {
    const [color, bg, letter] = COLORS[category] || COLORS.Outros;
    return `--category:${color};--category-soft:${bg}`;
  };
  const iconLetter = (category) => (COLORS[category] || COLORS.Outros)[2];
  const amountText = (value) => money.format(value || 0);
  const signedAmountText = (value) => amountText(value).replace(/^-/, '−');
  const getMonthTransactions = () => data.transactions.filter((item) => item.date?.slice(0, 7) === selectedMonth);
  const expenses = (items) => items.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const income = (items) => items.filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const sorted = (items) => [...items].sort((a, b) => b.date.localeCompare(a.date));
  const plural = (count, singular, pluralForm) => `${count} ${count === 1 ? singular : pluralForm}`;
  const parseLocalDate = (value) => {
    if (!value) return null;
    const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const prettyMonth = (value) => {
    const [year, month] = value.split('-').map(Number);
    return monthFormatter.format(new Date(year, month - 1, 1));
  };
  const formatDate = (value) => {
    if (!value) return '';
    const [year, month, day] = value.split('-').map(Number);
    return dateFormatter.format(new Date(year, month - 1, day));
  };
  const formatDayMonth = (value) => {
    const date = value instanceof Date ? value : parseLocalDate(value);
    if (!date) return '';
    return `${String(date.getDate()).padStart(2, '0')} ${shortMonthFormatter.format(date).replace('.', '')}`;
  };
  const previousMonthId = (value) => {
    const [year, month] = value.split('-').map(Number);
    return monthId(new Date(year, month - 2, 1));
  };
  const totalsForMonth = (value) => {
    const tx = data.transactions.filter((item) => item.date?.slice(0, 7) === value);
    const totalIncome = income(tx);
    const totalExpenses = expenses(tx);
    return { tx, income: totalIncome, expenses: totalExpenses, balance: totalIncome - totalExpenses };
  };

  const transactionPool = () => (searchTerm.trim() ? data.transactions : getMonthTransactions());

  function filteredTransactions() {
    const term = searchTerm.trim().toLowerCase();
    return transactionPool().filter((item) => {
      const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
      const matchesTerm = !term
        || [item.description, item.category, item.account, item.note]
          .some((field) => String(field || '').toLowerCase().includes(term));
      return matchesCategory && matchesTerm;
    });
  }

  function updateDataCounts(txSelector, budgetSelector, goalSelector) {
    const fill = (selector, count, singular, pluralLabel) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = plural(count, singular, pluralLabel);
    };
    fill(txSelector, data.transactions.length, 'lançamento', 'lançamentos');
    fill(budgetSelector, data.budgets.length, 'orçamento', 'orçamentos');
    fill(goalSelector, data.goals.length, 'meta', 'metas');
  }

  // SVGs for Brand & Tech Icons
  function brandIcon(name) {
    const icons = {
      spotify: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 5.524 4.477 10 10 10s10-4.476 10-10c0-5.523-4.477-10-10-10zm4.587 14.425c-.18.295-.563.387-.857.207-2.35-1.435-5.308-1.76-8.793-.963-.335.077-.67-.133-.746-.468-.077-.334.132-.67.467-.746 3.808-.87 7.076-.496 9.722 1.115.293.18.386.563.207.855zm1.225-2.723c-.226.367-.706.482-1.072.257-2.69-1.653-6.79-2.132-9.97-1.166-.413.125-.85-.107-.975-.52-.125-.414.107-.85.52-.976 3.633-1.102 8.147-.568 11.24 1.332.366.226.482.707.257 1.073zm.105-2.836C14.693 8.95 9.375 8.775 6.297 9.71c-.494.15-1.02-.128-1.17-.622-.15-.494.128-1.02.622-1.17 3.535-1.073 9.404-.866 13.115 1.338.445.264.59.838.327 1.282-.264.443-.838.59-1.282.327z"/></svg>`,
      amazon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.9 13.4c-.1.2-.3.3-.6.3-1 .4-2.4.6-3.8.6-2.5 0-3.9-.9-3.9-2.6 0-1.8 1.5-2.8 4.1-2.8 1.1 0 2.4.2 3.4.5v1.2c-.8-.2-2-.4-3.1-.4-1.6 0-2.3.5-2.3 1.4 0 1 .8 1.5 2.4 1.5 1 0 2.2-.2 3.1-.6v.9zm4.4 6.8c-3.1 2.2-7.5 3.3-11.4 3.3-5.4 0-10.2-2-13.9-5.3-.3-.3-.3-.8 0-1 .3-.3.8-.3 1 0 3.4 3 7.8 4.9 12.8 4.9 3.5 0 7.4-.9 10.3-2.9.4-.3.9-.1 1.2.2.3.4.2.9-.2 1.2l.2-.4zm-3-11.7v7.2c0 .9.2 1.4.9 1.4.4 0 .8-.1 1.2-.3.2-.1.4 0 .5.2.1.2 0 .5-.2.6-.6.3-1.3.5-2 .5-1.4 0-2-.9-2-2.3v-5.6h-1.4c-.3 0-.5-.2-.5-.5s.2-.5.5-.5h1.4V7.2c0-.3.2-.5.5-.5s.5.2.5.5v2.3h2.3c.3 0 .5.2.5.5s-.2.5-.5.5h-2.3z"/></svg>`,
      microsoft: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8.5" height="8.5" fill="#f25022"/><rect x="12.5" y="3" width="8.5" height="8.5" fill="#7fba00"/><rect x="3" y="12.5" width="8.5" height="8.5" fill="#00a4ef"/><rect x="12.5" y="12.5" width="8.5" height="8.5" fill="#ffb900"/></svg>`,
      nvidia: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.9 7.8c.8-.7 1.9-1.1 3.1-1.1 2.6 0 4.7 1.9 4.7 4.5 0 2.5-2.1 4.5-4.7 4.5-1.4 0-2.6-.6-3.4-1.6l-1.3 1.2c1.2 1.4 2.9 2.2 4.8 2.2 3.6 0 6.6-2.8 6.6-6.4 0-3.5-3-6.4-6.6-6.4-1.8 0-3.4.7-4.6 1.9l1.4 1.2z"/></svg>`,
      apple: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.38c.62-.75 1.04-1.8 0.93-2.85-.9.04-1.99.6-2.63 1.35-.57.65-1.07 1.71-.93 2.73 1 .08 2.02-.48 2.63-1.23z"/></svg>`,
      wallet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M16 14h2"/></svg>`,
      plane: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m21 3-7.2 18-3.6-7.2L3 10.2 21 3Z"/></svg>`,
      search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>`,
      download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v13m-5-5 5 5 5-5"/><path d="M5 19v2h14v-2"/></svg>`,
      arrowUpRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M7 7h10v10"/></svg>`
    };
    return icons[name] || icons.wallet;
  }

  function populateMonths() {
    const select = document.querySelector('#month-select');
    select.innerHTML = '';
    const months = new Set([selectedMonth]);
    for (let offset = 0; offset < 10; offset++) {
      months.add(monthId(new Date(today.getFullYear(), today.getMonth() - offset, 1)));
    }
    data.transactions.forEach((item) => {
      if (item.date) months.add(item.date.slice(0, 7));
    });
    [...months].sort((a, b) => b.localeCompare(a)).forEach((value) => {
      const [year, month] = value.split('-').map(Number);
      const d = new Date(year, month - 1, 1);
      const option = document.createElement('option');
      option.value = value;
      option.textContent = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' }).format(d);
      select.append(option);
    });
    select.value = selectedMonth;
  }

  function getMonthBudgets() {
    const tx = getMonthTransactions();
    return data.budgets.map((budget) => ({
      ...budget,
      spent: expenses(tx.filter((item) => item.category === budget.category))
    }));
  }

  function monthlyTotals() {
    return totalsForMonth(selectedMonth);
  }

  // Row for Transaction list
  function buildTransactionRow(item) {
    const isIncome = item.type === 'income';
    const signedAmount = `${isIncome ? '+' : '−'}${amountText(Number(item.amount))}`;
    return `
      <div class="transaction-row" data-row-id="${escapeHTML(item.id)}">
        <div class="transaction-name">
          <span class="transaction-icon" style="${categoryStyle(item.category)}">${iconLetter(item.category)}</span>
          <div class="transaction-name-copy">
            <strong>${escapeHTML(item.description)}</strong>
            <span>${escapeHTML(item.account || 'Conta Principal')}${item.note ? ` · ${escapeHTML(item.note)}` : ''}</span>
          </div>
        </div>
        <span class="transaction-category">${escapeHTML(item.category)}</span>
        <time class="transaction-date" datetime="${escapeHTML(item.date)}">${formatDate(item.date)}</time>
        <span class="transaction-amount ${isIncome ? 'is-income' : ''}">${signedAmount}</span>
      </div>
    `;
  }

  // ==========================================================
  // OVERVIEW — real KPIs, cumulative chart, recent transactions
  // ==========================================================
  function counterText(value, format) {
    return format === 'percent' ? `${percentFormatter.format(value)}%` : signedAmountText(value);
  }

  function formatCompactMoney(value) {
    const abs = Math.abs(value);
    if (abs >= 1000000) {
      return `${value < 0 ? '−' : ''}R$ ${(abs / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}mi`;
    }
    if (abs >= 1000) {
      return `${value < 0 ? '−' : ''}R$ ${(abs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
    }
    return `${value < 0 ? '−' : ''}R$ ${abs.toLocaleString('pt-BR', { maximumFractionDigits: abs < 10 ? 2 : 0 })}`;
  }

  function niceCeil(value) {
    const abs = Math.abs(value);
    if (!abs) return 0;
    const exponent = Math.floor(Math.log10(abs));
    const fraction = abs / 10 ** exponent;
    const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return Math.sign(value) * niceFraction * 10 ** exponent;
  }

  function chartRange(values) {
    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);
    if (min === 0 && max === 0) {
      max = 100;
    } else {
      if (min < 0) min = -niceCeil(-min);
      if (max > 0) max = niceCeil(max);
    }
    if (min === max) max = min + 1;
    return { min, max };
  }

  function buildChartSeries(period, metric = chartMetric) {
    const [year, month] = selectedMonth.split('-').map(Number);
    const monthEnd = new Date(year, month, 0);
    let start;
    let end = monthEnd;
    let label;
    if (period === '7d') {
      if (selectedMonth === currentMonth) {
        const now = new Date();
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (end > monthEnd) end = new Date(monthEnd);
      } else {
        end = new Date(monthEnd);
      }
      start = new Date(end);
      start.setDate(start.getDate() - 6);
      label = `Saldo acumulado · ${formatDayMonth(start)} a ${formatDayMonth(end)}`;
    } else if (period === '3m') {
      start = new Date(year, month - 3, 1);
      label = `Saldo acumulado · 3 meses até ${prettyMonth(selectedMonth)}`;
    } else {
      start = new Date(year, month - 1, 1);
      label = `Saldo acumulado · ${prettyMonth(selectedMonth)}`;
    }

    const byDay = new Map();
    let transactionCount = 0;
    data.transactions.forEach((item) => {
      const date = parseLocalDate(item.date);
      if (!date || date < start || date > end) return;
      const key = localISODate(date);
      const amountCents = Math.round(Number(item.amount || 0) * 100);
      const totals = byDay.get(key) || { income: 0, expenses: 0 };
      totals[item.type === 'income' ? 'income' : 'expenses'] += amountCents;
      byDay.set(key, totals);
      transactionCount += 1;
    });

    const points = [];
    let cumulativeIncome = 0;
    let cumulativeExpenses = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = localISODate(cursor);
      const daily = byDay.get(key) || { income: 0, expenses: 0 };
      cumulativeIncome += daily.income;
      cumulativeExpenses += daily.expenses;
      let value = (cumulativeIncome - cumulativeExpenses) / 100;
      if (metric === 'income') value = cumulativeIncome / 100;
      if (metric === 'expenses') value = cumulativeExpenses / 100;
      if (metric === 'savings') {
        value = cumulativeIncome > 0
          ? ((cumulativeIncome - cumulativeExpenses) / cumulativeIncome) * 100
          : null;
      }
      points.push({ date: new Date(cursor), value });
      cursor.setDate(cursor.getDate() + 1);
    }
    const metricLabels = {
      balance: 'Saldo acumulado',
      income: 'Receitas acumuladas',
      expenses: 'Despesas acumuladas',
      savings: 'Taxa de economia'
    };
    const hasMetricData = metric === 'savings'
      ? points.some((point) => Number.isFinite(point.value))
      : transactionCount > 0;
    return {
      points,
      start,
      end,
      label: `${metricLabels[metric]} · ${label.replace(/^Saldo acumulado · /, '')}`,
      metricLabel: metricLabels[metric],
      hasMetricData
    };
  }

  function chartXLabels(series, period) {
    if (period === '3m') {
      const labels = [];
      const cursor = new Date(series.start.getFullYear(), series.start.getMonth(), 1);
      while (cursor <= series.end) {
        labels.push(shortMonthFormatter.format(cursor).replace('.', ''));
        cursor.setMonth(cursor.getMonth() + 1);
      }
      return labels;
    }
    const count = period === '7d' ? 4 : 5;
    const indices = new Set();
    for (let i = 0; i < count; i += 1) {
      indices.add(Math.round((i * (series.points.length - 1)) / Math.max(1, count - 1)));
    }
    return [...indices].sort((a, b) => a - b).map((index) => formatDayMonth(series.points[index].date));
  }

  function linePath(points) {
    if (!points.length) return '';
    if (points.length === 1) return `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
    let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
    for (let i = 0; i < points.length - 1; i += 1) {
      const current = points[i];
      const next = points[i + 1];
      d += ` L${next.x.toFixed(2)},${next.y.toFixed(2)}`;
    }
    return d;
  }

  function renderOverviewChart() {
    const body = viewRoot.querySelector('#overview-chart-body');
    const subtitle = viewRoot.querySelector('#overview-chart-subtitle');
    if (!body) return;
    const series = buildChartSeries(chartPeriod, chartMetric);
    if (subtitle) subtitle.textContent = series.label;
    const title = viewRoot.querySelector('#overview-chart-title');
    if (title) title.textContent = `Evolução · ${series.metricLabel.toLocaleLowerCase('pt-BR')}`;
    viewRoot.querySelectorAll('[data-chart-period]').forEach((button) => {
      const active = button.dataset.chartPeriod === chartPeriod;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    if (!series.hasMetricData) {
      const labels = chartXLabels(series, chartPeriod);
      const noIncome = chartMetric === 'savings' && series.points.length > 0;
      body.innerHTML = `
        <div class="chart-area chart-area-empty">
          <div class="chart-y" aria-hidden="true"><span>${noIncome ? '—' : chartMetric === 'savings' ? '0%' : 'R$ 0'}</span></div>
          <div class="chart-plot">
            <svg class="chart-svg" viewBox="0 0 1000 260" preserveAspectRatio="none" aria-hidden="true">
              ${noIncome ? '' : '<line class="zero-line" x1="0" y1="130" x2="1000" y2="130" />'}
            </svg>
          </div>
        </div>
        <div class="chart-x" aria-hidden="true">${labels.map((label) => `<span>${escapeHTML(label)}</span>`).join('')}</div>
        <p class="chart-empty-note">${noIncome ? 'Sem receitas para calcular a taxa neste período.' : 'Sem lançamentos neste período.'}</p>`;
      return;
    }

    const values = series.points.map((point) => point.value).filter(Number.isFinite);
    const { min, max } = chartRange(values);
    const ticks = [max, max - (max - min) / 3, max - 2 * (max - min) / 3, min];
    const width = 1000;
    const top = 32;
    const bottom = 227;
    const height = bottom - top;
    const zeroY = bottom - ((0 - min) / (max - min)) * height;
    const xAt = (index) => (series.points.length === 1 ? width / 2 : (index / (series.points.length - 1)) * width);
    const yAt = (value) => bottom - ((value - min) / (max - min)) * height;
    const plotted = series.points.flatMap((point, index) => Number.isFinite(point.value)
      ? [{ x: xAt(index), y: yAt(point.value) }]
      : []);
    const path = linePath(plotted);
    const last = series.points[series.points.length - 1];
    const labels = chartXLabels(series, chartPeriod);
    const formatTick = chartMetric === 'savings'
      ? (value) => `${percentFormatter.format(value)}%`
      : formatCompactMoney;
    body.innerHTML = `
      <div class="chart-area">
        <div class="chart-y" aria-hidden="true">${ticks.map((tick) => `<span>${formatTick(tick)}</span>`).join('')}</div>
        <div class="chart-plot">
          <svg class="chart-svg" viewBox="0 0 ${width} 260" preserveAspectRatio="none" role="img" aria-label="${escapeHTML(series.label)}. Valor no fim do período: ${escapeHTML(formatTick(last.value))}.">
            <g class="grid" aria-hidden="true">
              <line x1="0" y1="32" x2="1000" y2="32" />
              <line x1="0" y1="97" x2="1000" y2="97" />
              <line x1="0" y1="162" x2="1000" y2="162" />
              <line x1="0" y1="227" x2="1000" y2="227" />
            </g>
            ${min < 0 && max > 0 ? `<line class="zero-line" x1="0" y1="${zeroY.toFixed(2)}" x2="1000" y2="${zeroY.toFixed(2)}" />` : ''}
            <path class="line" d="${path}" />
          </svg>
        </div>
      </div>
      <div class="chart-x" aria-hidden="true">${labels.map((label) => `<span>${escapeHTML(label)}</span>`).join('')}</div>
    `;
  }

  function trendArrow(direction) {
    return direction === 'down'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
  }

  function percentTrend(current, previous, options = {}) {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return '';
    const change = ((current - previous) / Math.abs(previous)) * 100;
    if (!Number.isFinite(change) || Math.abs(change) < 0.05) return '';
    const favorable = options.invert ? change < 0 : change > 0;
    const direction = change > 0 ? 'up' : 'down';
    return `<span class="kpi-trend ${favorable ? 'is-up' : 'is-down'}">${change > 0 ? '+' : '−'}${percentFormatter.format(Math.abs(change))}%</span>`;
  }

  function pointsTrend(current, previous) {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return '';
    const diff = current - previous;
    if (Math.abs(diff) < 0.05) return '';
    return `<span class="kpi-trend ${diff > 0 ? 'is-up' : 'is-down'}">${diff > 0 ? '+' : '−'}${percentFormatter.format(Math.abs(diff))} p.p.</span>`;
  }

  function kpiCard({ metric, label, value, format, trend, note }) {
    const hasValue = Number.isFinite(value);
    const display = hasValue ? escapeHTML(counterText(value, format)) : '—';
    return `
      <button class="kpi-card ${metric === chartMetric ? 'is-active' : ''}" type="button" data-chart-metric="${metric}" aria-pressed="${metric === chartMetric}">
        <span class="kpi-label">${escapeHTML(label)}</span>
        <span class="kpi-value-row">
          <strong class="kpi-value">${display}</strong>
          ${trend || ''}
        </span>
        <span class="kpi-note">${note}</span>
      </button>`;
  }

  function buildOverview() {
    const totals = monthlyTotals();
    const prevMonth = previousMonthId(selectedMonth);
    const prevTotals = totalsForMonth(prevMonth);
    const latest = sorted(totals.tx).slice(0, 6);
    const currentRate = totals.income > 0 ? (totals.balance / totals.income) * 100 : null;
    const prevRate = prevTotals.income > 0 ? (prevTotals.balance / prevTotals.income) * 100 : null;
    const previousMonthLabel = escapeHTML(prettyMonth(prevMonth));
    const selectedMonthLabel = escapeHTML(prettyMonth(selectedMonth));
    const budgetTotal = data.budgets.reduce((sum, item) => sum + Number(item.limit || 0), 0);
    const budgetDiff = budgetTotal - totals.expenses;
    const expenseNote = budgetTotal > 0
      ? budgetDiff >= 0
        ? `<strong>abaixo do orçamento</strong> em ${escapeHTML(amountText(budgetDiff))}`
        : `<strong>acima do orçamento</strong> em ${escapeHTML(amountText(Math.abs(budgetDiff)))}`
      : `<strong>total de saídas</strong> em ${selectedMonthLabel}`;
    const balanceNote = `${prevTotals.balance !== 0 ? `<strong>vs. ${previousMonthLabel}</strong>` : `<strong>${selectedMonthLabel}</strong>`} · entradas menos despesas`;
    const incomeNote = `${prevTotals.income > 0 ? `<strong>vs. ${previousMonthLabel}</strong>` : `<strong>${selectedMonthLabel}</strong>`} · total de entradas`;
    const rateNote = currentRate === null
      ? '<strong>sem receitas</strong> no período'
      : `${prevRate !== null ? `<strong>vs. ${previousMonthLabel}</strong>` : `<strong>${selectedMonthLabel}</strong>`} · do total de receitas`;
    const cards = [
      kpiCard({ metric: 'balance', label: 'Saldo do mês', value: totals.balance, format: 'currency', trend: percentTrend(totals.balance, prevTotals.balance), note: balanceNote }),
      kpiCard({ metric: 'income', label: 'Receitas', value: totals.income, format: 'currency', trend: percentTrend(totals.income, prevTotals.income), note: incomeNote }),
      kpiCard({ metric: 'expenses', label: 'Despesas', value: totals.expenses, format: 'currency', trend: percentTrend(totals.expenses, prevTotals.expenses, { invert: true }), note: expenseNote }),
      kpiCard({ metric: 'savings', label: 'Taxa de economia', value: currentRate, format: 'percent', trend: previousRateTrend(currentRate, prevRate), note: rateNote })
    ].join('');

    const filterIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
    const rows = latest.map((item) => {
      const isIncome = item.type === 'income';
      const [color] = COLORS[item.category] || COLORS.Outros;
      return `
        <tr data-type="${isIncome ? 'income' : 'expense'}">
          <td>
            <div class="tx-name">
              <span class="tx-mark ${isIncome ? 'is-in' : ''}" aria-hidden="true">${trendArrow(isIncome ? 'up' : 'down')}</span>
              <span class="tx-info">
                <span class="tx-title">${escapeHTML(item.description)}</span>
                <span class="tx-sub">${escapeHTML(item.note || (isIncome ? 'Entrada' : 'Saída'))}</span>
              </span>
            </div>
          </td>
          <td><span class="category"><span class="cat-dot" style="background:${color}" aria-hidden="true"></span>${escapeHTML(item.category)}</span></td>
          <td>${escapeHTML(item.account || 'Conta Principal')}</td>
          <td><span class="status ${isIncome ? 'status--income' : 'status--expense'}"><span class="status-dot" aria-hidden="true"></span>${isIncome ? 'Receita' : 'Despesa'}</span></td>
          <td class="tx-date"><time datetime="${escapeHTML(item.date)}">${escapeHTML(formatDayMonth(item.date))}</time></td>
          <td class="tx-amount ${isIncome ? 'is-in' : ''}">${isIncome ? '+' : '−'} ${escapeHTML(amountText(Number(item.amount)))}</td>
        </tr>`;
    }).join('');
    const tableBody = latest.length ? rows : `
      <tr>
        <td colspan="6">
          <div class="table-empty">
            <span>Nenhum lançamento em ${selectedMonthLabel}.</span>
            <button class="button button-glass" type="button" data-action="add-transaction">Adicionar lançamento</button>
          </div>
        </td>
      </tr>`;
    const totalLabel = plural(totals.tx.length, 'lançamento', 'lançamentos');

    viewRoot.innerHTML = `
      <section class="overview-layout">
        <section class="kpi-grid" aria-label="Resumo do mês">${cards}</section>
        <section class="panel chart-panel" aria-labelledby="overview-chart-title">
          <div class="panel-head">
            <div>
              <h2 class="panel-title" id="overview-chart-title">Evolução · saldo acumulado</h2>
              <p class="panel-subtitle" id="overview-chart-subtitle"></p>
            </div>
            <div class="segmented" role="group" aria-label="Período do gráfico">
              <button type="button" data-chart-period="3m" aria-pressed="${chartPeriod === '3m'}">3 meses</button>
              <button type="button" data-chart-period="30d" aria-pressed="${chartPeriod === '30d'}">30 dias</button>
              <button type="button" data-chart-period="7d" aria-pressed="${chartPeriod === '7d'}">7 dias</button>
            </div>
          </div>
          <div id="overview-chart-body"></div>
        </section>
        <section class="panel table-panel" aria-labelledby="overview-table-title">
          <div class="panel-head">
            <div>
              <h2 class="panel-title" id="overview-table-title">Últimos lançamentos</h2>
              <p class="panel-subtitle">${escapeHTML(`${totalLabel} em ${prettyMonth(selectedMonth)}`)}</p>
            </div>
            <div class="table-tools">
              <div class="segmented" role="group" aria-label="Filtrar lançamentos">
                <button type="button" class="is-active" data-overview-filter="all" aria-pressed="true">Todos</button>
                <button type="button" data-overview-filter="income" aria-pressed="false">Receitas</button>
                <button type="button" data-overview-filter="expense" aria-pressed="false">Despesas</button>
              </div>
              <a class="filter-btn" href="#transacoes" data-view="transactions">${filterIcon} Filtrar</a>
            </div>
          </div>
          <div class="table-scroll">
            <table>
              <caption class="sr-only">Últimos lançamentos de ${selectedMonthLabel}</caption>
              <thead>
                <tr>
                  <th scope="col">Lançamento</th>
                  <th scope="col">Categoria</th>
                  <th scope="col">Conta</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Data</th>
                  <th scope="col" class="num">Valor</th>
                </tr>
              </thead>
              <tbody id="overview-transaction-rows">${tableBody}</tbody>
            </table>
          </div>
          <div class="table-foot">
            <span id="overview-table-count">Mostrando ${latest.length} de ${totalLabel}</span>
            <a href="#transacoes" data-view="transactions">Ver todos</a>
          </div>
        </section>
      </section>`;

    viewRoot.querySelectorAll('[data-chart-period]').forEach((button) => {
      button.addEventListener('click', () => {
        chartPeriod = button.dataset.chartPeriod;
        renderOverviewChart();
      });
    });
    viewRoot.querySelectorAll('[data-chart-metric]').forEach((button) => {
      button.addEventListener('click', () => {
        chartMetric = button.dataset.chartMetric;
        viewRoot.querySelectorAll('[data-chart-metric]').forEach((item) => {
          const selected = item === button;
          item.classList.toggle('is-active', selected);
          item.setAttribute('aria-pressed', String(selected));
        });
        renderOverviewChart();
      });
    });
    renderOverviewChart();

    const filterButtons = Array.from(viewRoot.querySelectorAll('[data-overview-filter]'));
    filterButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const filter = button.dataset.overviewFilter;
        filterButtons.forEach((item) => {
          const active = item === button;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-pressed', String(active));
        });
        let visible = 0;
        viewRoot.querySelectorAll('#overview-transaction-rows tr').forEach((row) => {
          const isEmptyRow = Boolean(row.querySelector('.table-empty'));
          const show = isEmptyRow || filter === 'all' || row.dataset.type === filter;
          row.hidden = !show;
          if (!isEmptyRow && show) visible += 1;
        });
        const count = viewRoot.querySelector('#overview-table-count');
        if (count) count.textContent = `Mostrando ${visible} de ${totalLabel}`;
      });
    });

  }

  function previousRateTrend(currentRate, previousRate) {
    return currentRate !== null && previousRate !== null ? pointsTrend(currentRate, previousRate) : '';
  }
  function buildTransactionsView() {
    const items = filteredTransactions();
    const categories = [...new Set(data.transactions.map((item) => item.category))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    viewRoot.innerHTML = `
      <section class="view-panel-glass">
        <div class="view-toolbar">
          <div class="view-title-group">
            <h2>Lançamentos do Período</h2>
            <p>Gerencie entradas, despesas e transações de investimentos.</p>
          </div>
          <div class="table-controls">
            <select id="category-filter" class="filter-select-dark">
              <option value="all">Todas as Categorias</option>
              ${categories.map((c) => `<option value="${escapeHTML(c)}" ${categoryFilter === c ? 'selected' : ''}>${escapeHTML(c)}</option>`).join('')}
            </select>
            <button class="button button-glass export-button" data-action="export" type="button">
              ${brandIcon('download')}
              <span>Exportar CSV</span>
            </button>
          </div>
        </div>

        <div class="transaction-list-container" id="full-transaction-list">
          ${items.length ? items.map(buildTransactionRow).join('') : `<div class="empty-state">Nenhum lançamento corresponde a esta busca.</div>`}
        </div>

        <div class="transactions-footer">
          <span>${items.length} de ${transactionPool().length} lançamentos</span>
          <span>Armazenado no dispositivo</span>
        </div>
      </section>
    `;

    const catSelect = document.querySelector('#category-filter');
    if (catSelect) {
      catSelect.addEventListener('change', (e) => {
        categoryFilter = e.target.value;
        buildTransactionsView();
      });
    }
  }

  // ==========================================================
  // BUDGETS VIEW
  // ==========================================================
  function buildBudgetView() {
    const budgets = getMonthBudgets();
    const cap = budgets.reduce((sum, item) => sum + Number(item.limit), 0);
    const spent = budgets.reduce((sum, item) => sum + item.spent, 0);

    viewRoot.innerHTML = `
      <div class="view-panel-glass">
        <div class="view-toolbar">
          <div class="view-title-group">
            <h2>Limites por Categoria</h2>
            <p>${budgets.length ? `${amountText(spent)} utilizados de ${amountText(cap)} no período selecionado` : 'Defina limites por categoria para acompanhar seus gastos.'}</p>
          </div>
          <button class="button button-glowing" type="button" data-action="edit-budgets">
            Editar limites
          </button>
        </div>

        <div class="budget-view-grid">
          ${budgets.length ? budgets.map((item) => {
            const pct = item.limit > 0 ? Math.round((item.spent / item.limit) * 100) : (item.spent > 0 ? 100 : 0);
            return `
              <article class="budget-view-item">
                <div class="budget-item-head">
                  <span class="category-name">
                    ${escapeHTML(item.category)}
                  </span>
                  <span class="budget-amounts"><strong>${amountText(item.spent)}</strong> / ${amountText(item.limit)}</span>
                </div>
                <div class="budget-meter">
                  <span style="--used:${Math.min(pct, 100)}%;--meter:${pct > 100 ? 'var(--negative)' : 'var(--accent)'}"></span>
                </div>
                <p>${pct > 100 ? `Ultrapassou em ${amountText(item.spent - item.limit)}.` : `Restam ${amountText(Math.max(0, item.limit - item.spent))} disponíveis.`}</p>
              </article>
            `;
          }).join('') : '<p class="empty-state">Nenhum limite definido para este período.</p>'}
        </div>
      </div>
    `;
  }

  // ==========================================================
  // GOALS VIEW
  // ==========================================================
  function buildGoalsView() {
    viewRoot.innerHTML = `
      <div class="view-panel-glass">
        <div class="view-toolbar">
          <div class="view-title-group">
            <h2>Metas e Conquistas Financeiras</h2>
            <p>Acompanhe a evolução de aportes e objetivos de longo prazo.</p>
          </div>
          <button class="button button-glowing" type="button" data-action="add-goal">
            + Nova meta
          </button>
        </div>

        <div class="goal-view-grid">
          ${data.goals.length ? data.goals.map((goal) => {
            const percent = goal.target > 0 ? Math.min(100, Math.round((goal.saved / goal.target) * 100)) : 0;
            return `
              <article class="goal-view-card">
                <div class="goal-top">
                  <div class="goal-title">
                    <strong>${escapeHTML(goal.name)}</strong>
                    <span>${escapeHTML(goal.due || 'Objetivo pessoal')}</span>
                  </div>
                </div>
                <div class="goal-values">
                  <strong>${amountText(goal.saved)}</strong>
                  <span>de ${amountText(goal.target)}</span>
                </div>
                <div class="budget-meter">
                  <span style="--used:${percent}%;--meter:var(--accent)"></span>
                </div>
                <div class="goal-foot">
                  <span>${percent}% alcançado</span>
                  <span>Faltam ${amountText(Math.max(0, goal.target - goal.saved))}</span>
                </div>
              </article>
            `;
          }).join('') : '<p class="empty-state">Nenhuma meta criada.</p>'}
        </div>
      </div>
    `;
  }

  // ==========================================================
  // REPORTS VIEW
  // ==========================================================
  function buildReportsView() {
    const totals = monthlyTotals();
    const tx = getMonthTransactions().filter((item) => item.type === 'expense');
    const catMap = new Map();
    tx.forEach((item) => catMap.set(item.category, (catMap.get(item.category) || 0) + Number(item.amount)));
    const categories = [...catMap.entries()].sort((a, b) => b[1] - a[1]);
    const maximum = Math.max(...categories.map(([, v]) => v), 1);
    const avg = totals.tx.length ? totals.expenses / Math.max(1, tx.length) : 0;

    viewRoot.innerHTML = `
      <div class="report-grid">
        <section class="panel-card">
          <div class="panel-card-head">
            <h3 class="panel-card-title">Despesas por Categoria</h3>
          </div>
          <div class="report-category-list">
            ${categories.length ? categories.map(([category, value]) => `
              <div class="report-category-row">
                <span class="category-name">
                  ${escapeHTML(category)}
                </span>
                <div class="budget-meter">
                  <span style="--used:${(value / maximum) * 100}%;--meter:var(--accent)"></span>
                </div>
                <span class="budget-amounts">${amountText(value)}</span>
              </div>
            `).join('') : '<div class="empty-state">Sem dados para este período.</div>'}
          </div>
        </section>

        <section class="panel-card">
          <div class="panel-card-head">
            <h3 class="panel-card-title">Resumo do Período</h3>
          </div>
          <div class="report-summary">
            <p>Total de Entradas</p>
            <strong>${amountText(totals.income)}</strong>
            <p>Total de Despesas</p>
            <strong>${amountText(totals.expenses)}</strong>
            <p>Média por Lançamento</p>
            <strong>${totals.tx.length ? amountText(avg) : '—'}</strong>
            <p>Saldo do Período</p>
            <strong>${amountText(totals.balance)}</strong>
          </div>
        </section>
      </div>
    `;
  }

  const viewDetails = {
    overview: ['Visão geral', 'Entradas, despesas e o ritmo do seu mês em um só lugar.'],
    transactions: ['Transações', 'Consulte e filtre os lançamentos do período selecionado.'],
    budgets: ['Orçamentos', 'Acompanhe os limites que você definiu para cada categoria.'],
    goals: ['Metas', 'Dê forma aos seus planos acompanhando cada valor guardado.'],
    reports: ['Relatórios', 'Consulte a distribuição das despesas por categoria no período.']
  };

  function render() {
    const [greeting, subtitle] = viewDetails[view] || viewDetails.overview;
    const pageGreeting = document.querySelector('#page-greeting');
    const pageSubtitle = document.querySelector('#page-subtitle');
    const breadcrumb = document.querySelector('#breadcrumb-current');
    if (pageGreeting) pageGreeting.textContent = greeting;
    if (pageSubtitle) pageSubtitle.textContent = subtitle;
    if (breadcrumb) breadcrumb.textContent = greeting;

    document.querySelectorAll('[data-view]').forEach((link) => {
      const active = link.dataset.view === view;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    if (view === 'transactions') buildTransactionsView();
    else if (view === 'budgets') buildBudgetView();
    else if (view === 'goals') buildGoalsView();
    else if (view === 'reports') buildReportsView();
    else buildOverview();
  }

  function setView(nextView, options = {}) {
    if (!viewDetails[nextView]) return;
    const sidebar = document.querySelector('.sidebar');
    const menuToggle = document.querySelector('#mobile-menu-toggle');
    if (sidebar) sidebar.classList.remove('is-open');
    if (menuToggle) {
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('aria-label', 'Abrir menu');
    }
    view = nextView;
    if (!options.keepSearch) {
      searchTerm = '';
      const searchInput = document.querySelector('#global-search');
      if (searchInput) searchInput.value = '';
    }
    if (!options.keepFilters) categoryFilter = 'all';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showToast(message) {
    const toast = document.querySelector('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3200);
  }

  function openTransactionDialog() {
    form.elements.date.value = localISODate();
    form.elements.category.innerHTML = categoryOptions('expense');
    form.elements.type.value = 'expense';
    form.elements.description.value = '';
    form.elements.amount.value = '';
    form.elements.note.value = '';
    document.querySelectorAll('.type-option').forEach((option) => option.classList.toggle('is-selected', option.dataset.type === 'expense'));
    dialog.showModal();
    window.setTimeout(() => form.elements.description.focus(), 40);
  }

  function categoryOptions(type) {
    const categories = type === 'income' ? ['Salário', 'Extra', 'Outros'] : ['Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Outros'];
    return categories.map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join('');
  }

  function openGoalDialog() {
    const goalDialog = document.querySelector('#goal-dialog');
    const goalForm = document.querySelector('#goal-form');
    goalForm.reset();
    goalForm.elements.saved.value = '0';
    goalDialog.showModal();
    window.setTimeout(() => goalForm.elements.name.focus(), 40);
  }

  function saveGoal(event) {
    event.preventDefault();
    const goalForm = event.currentTarget;
    if (!goalForm.reportValidity()) return;
    const values = new FormData(goalForm);
    const target = Number(values.get('target'));
    const saved = Number(values.get('saved'));
    if (!(target > 0) || saved < 0) return;
    data.goals.push({ id: id(), name: String(values.get('name')).trim(), target, saved, due: 'Meta Pessoal' });
    saveData();
    document.querySelector('#goal-dialog').close();
    render();
    showToast('Meta criada com sucesso.');
  }

  function openBudgetDialog() {
    const fields = document.querySelector('#budget-fields');
    const categories = Object.keys(COLORS).slice(0, 7);
    fields.innerHTML = categories.map((category) => {
      const budget = data.budgets.find((item) => item.category === category);
      return `
        <label class="form-field">
          <span>${escapeHTML(category)}</span>
          <span class="currency-input">
            <span>R$</span>
            <input name="${escapeHTML(category)}" type="number" min="0" step="0.01" value="${budget ? Number(budget.limit).toFixed(2) : ''}" placeholder="0,00" />
          </span>
        </label>
      `;
    }).join('');
    document.querySelector('#budget-dialog').showModal();
  }

  function saveBudgets(event) {
    event.preventDefault();
    const budgetForm = event.currentTarget;
    if (!budgetForm.reportValidity()) return;
    const values = new FormData(budgetForm);
    const categories = Object.keys(COLORS).slice(0, 7);
    data.budgets = categories.flatMap((category) => {
      const rawLimit = String(values.get(category) || '').trim();
      return rawLimit && Number(rawLimit) > 0 ? [{ category, limit: Number(rawLimit) }] : [];
    });
    saveData();
    document.querySelector('#budget-dialog').close();
    render();
    showToast('Limites de orçamento atualizados.');
  }

  function exportCSV() {
    const rows = [['Data', 'Descrição', 'Tipo', 'Categoria', 'Conta', 'Valor', 'Observação']];
    filteredTransactions().forEach((item) => rows.push([item.date, item.description, item.type === 'income' ? 'Receita' : 'Despesa', item.category, item.account || '', Number(item.amount).toFixed(2).replace('.', ','), item.note || '']));
    const csv = '\uFEFF' + rows.map((row) => row.map((cell) => {
      const value = String(cell);
      const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
      return `"${safe.replaceAll('"', '""')}"`;
    }).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `moneyvault-${selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Exportação CSV gerada para download.');
  }

  function bindGlobalEvents() {
    const sidebar = document.querySelector('.sidebar');
    const menuToggle = document.querySelector('#mobile-menu-toggle');
    if (sidebar && menuToggle) {
      menuToggle.addEventListener('click', () => {
        const isOpen = sidebar.classList.toggle('is-open');
        menuToggle.setAttribute('aria-expanded', String(isOpen));
        menuToggle.setAttribute('aria-label', isOpen ? 'Fechar menu' : 'Abrir menu');
      });
    }

    // Navigation links
    document.querySelectorAll('[data-view]').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const next = link.dataset.view;
        history.replaceState(null, '', link.getAttribute('href'));
        setView(next);
      });
    });

    // Month Selector
    document.querySelector('#month-select').addEventListener('change', (event) => {
      selectedMonth = event.target.value;
      render();
    });

    // Add transaction CTA
    document.querySelector('#add-transaction').addEventListener('click', openTransactionDialog);

    // Global Search Bar in Topbar
    const globalSearch = document.querySelector('#global-search');
    if (globalSearch) {
      globalSearch.addEventListener('input', (event) => {
        searchTerm = event.target.value;
        if (view !== 'transactions') {
          setView('transactions', { keepSearch: true });
        } else {
          buildTransactionsView();
        }
      });
    }

    // Notifications & Settings alerts
    const notifBtn = document.querySelector('.notifications');
    if (notifBtn) notifBtn.addEventListener('click', () => showToast('Nenhuma notificação pendente na sua carteira.'));

    const profileMore = document.querySelector('.profile-more');
    if (profileMore) profileMore.addEventListener('click', () => showToast('Perfil local: Meu Espaço. Seus dados ficam somente neste dispositivo.'));

    const btnSupport = document.querySelector('#btn-support');
    if (btnSupport) btnSupport.addEventListener('click', () => showToast('Suporte MoneyVault: suporte@moneyvault.app'));

    // Dialog close handlers
    document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
    document.querySelector('.dialog-cancel').addEventListener('click', () => dialog.close());

    // Type Switcher in transaction dialog
    document.querySelectorAll('.type-option').forEach((option) => option.addEventListener('click', () => {
      const type = option.dataset.type;
      form.elements.type.value = type;
      form.elements.category.innerHTML = categoryOptions(type);
      document.querySelectorAll('.type-option').forEach((b) => b.classList.toggle('is-selected', b === option));
    }));

    // Form submit
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = new FormData(form);
      const transaction = {
        id: id(),
        description: String(values.get('description')).trim(),
        amount: Number(values.get('amount')),
        type: String(values.get('type')),
        category: String(values.get('category')),
        account: String(values.get('account')),
        date: String(values.get('date')),
        note: String(values.get('note') || '').trim()
      };
      if (!transaction.description || !(transaction.amount > 0) || !transaction.date) return;
      data.transactions.push(transaction);
      saveData();
      dialog.close();
      selectedMonth = transaction.date.slice(0, 7);
      document.querySelector('#month-select').value = selectedMonth;
      render();
      showToast('Lançamento registrado com sucesso!');
    });

    // Clear all data — managed via the Settings sidebar button
    document.querySelector('#btn-settings').addEventListener('click', () => {
      updateDataCounts('#settings-tx-count', '#settings-budget-count', '#settings-goal-count');
      document.querySelector('#settings-dialog').showModal();
    });

    document.querySelector('.settings-dialog-close').addEventListener('click', () => document.querySelector('#settings-dialog').close());

    document.querySelector('#open-clear-data').addEventListener('click', () => {
      updateDataCounts('#clear-tx-count', '#clear-budget-count', '#clear-goal-count');
      document.querySelector('#settings-dialog').close();
      document.querySelector('#clear-data-dialog').showModal();
    });

    document.querySelector('.clear-data-close').addEventListener('click', () => document.querySelector('#clear-data-dialog').close());
    document.querySelector('.clear-data-cancel').addEventListener('click', () => document.querySelector('#clear-data-dialog').close());

    document.querySelector('#confirm-clear-data').addEventListener('click', async () => {
      document.querySelector('#clear-data-dialog').close();
      transactionSyncPaused = true;
      while (transactionSyncInProgress) {
        await new Promise((resolve) => window.setTimeout(resolve, 25));
      }
      try {
        await fetch('/api/transactions', { method: 'DELETE' });
      } catch {
        // Local data can still be cleared while the API is offline.
      } finally {
        transactionSyncPaused = false;
      }
      data = emptyData();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      selectedMonth = currentMonth;
      document.querySelector('#month-select').value = currentMonth;
      render();
      syncTransactions();
      showToast('Todos os dados foram excluídos.');
    });

    // View action delegator
    viewRoot.addEventListener('click', (event) => {
      const viewLink = event.target.closest('[data-view]');
      if (viewLink) {
        event.preventDefault();
        history.replaceState(null, '', viewLink.getAttribute('href'));
        setView(viewLink.dataset.view);
        return;
      }
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'edit-budgets') openBudgetDialog();
      if (action === 'add-goal') openGoalDialog();
      if (action === 'export') exportCSV();
      if (action === 'add-transaction') openTransactionDialog();
    });

    // Goals & Budgets dialog buttons
    document.querySelector('.goal-dialog-close').addEventListener('click', () => document.querySelector('#goal-dialog').close());
    document.querySelector('.goal-dialog-cancel').addEventListener('click', () => document.querySelector('#goal-dialog').close());
    document.querySelector('#goal-form').addEventListener('submit', saveGoal);

    document.querySelector('.budget-dialog-close').addEventListener('click', () => document.querySelector('#budget-dialog').close());
    document.querySelector('.budget-dialog-cancel').addEventListener('click', () => document.querySelector('#budget-dialog').close());
    document.querySelector('#budget-form').addEventListener('submit', saveBudgets);

    window.addEventListener('hashchange', () => {
      const target = document.querySelector(`[data-view][href="${location.hash}"]`);
      if (target) setView(target.dataset.view);
    });
  }

  populateMonths();
  bindGlobalEvents();
  render();
  syncTransactions();
  window.setInterval(syncTransactions, 5000);
})();
