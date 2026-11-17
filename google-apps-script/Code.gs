/**
 * 위클리 ↔ 구글 캘린더 연결 (Google Apps Script 웹앱)
 *
 * 할 수 있는 일은 딱 두 가지예요.
 *   - list : 내 일정(지정한 색 또는 키워드가 들어간 일정)을 읽기만 합니다.
 *   - add  : 새 일정을 추가합니다.
 * 수정·삭제 코드는 일부러 넣지 않았어요. 실수로 지워질 일이 없습니다.
 *
 * 배포: 배포 > 새 배포 > 유형: 웹 앱 / 실행 사용자: 나 / 액세스 권한: 모든 사용자
 * 배포 후 나오는 웹 앱 URL(…/exec)과 아래 TOKEN 값을 위클리 설정에 넣으세요.
 * 일정은 이 스크립트를 배포한 계정의 기본 캘린더에서 읽고, 거기에 추가합니다.
 */
var TOKEN = '__WEEKLY_TOKEN__';   // 위클리 설정의 "연결 비밀키"와 같은 값 (아무도 모르게 길게)
var TZ = 'Asia/Seoul';
var MAX_DAYS = 400;               // 한 번에 읽을 수 있는 최대 기간

function doGet() {
  // 주소가 살아 있는지만 알려줍니다. 일정 내용은 비밀키 없이 절대 내보내지 않아요.
  return json_({ ok: true, app: 'weekly-todo', mode: 'list-add' });
}

function doPost(e) {
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!TOKEN || TOKEN.indexOf('__') === 0) throw new Error('스크립트의 TOKEN 값을 먼저 정해주세요');
    if (String(d.token || '') !== TOKEN) throw new Error('연결 비밀키가 맞지 않아요');
    var cal = CalendarApp.getDefaultCalendar();
    if (d.action === 'ping') return json_({ ok: true, app: 'weekly-todo', calendar: cal.getName() });
    if (d.action === 'list') return json_(list_(cal, d));
    if (d.action === 'add') return json_(add_(cal, d));
    throw new Error('지원하지 않는 요청이에요 (읽기 · 추가만 가능)');
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

// ---------- 읽기 (색 또는 키워드가 맞는 일정만) ----------
function list_(cal, d) {
  var from = ymd_(d.from), to = ymd_(d.to);
  if (!from || !to) throw new Error('기간이 올바르지 않아요');
  var end = new Date(to.getTime() + 24 * 3600 * 1000);
  if (end <= from || (end - from) / 86400000 > MAX_DAYS) throw new Error('기간은 ' + MAX_DAYS + '일 이내로 요청해주세요');
  var color = colorId_(d.color);
  var kws = (Array.isArray(d.keywords) ? d.keywords : []).map(function (k) { return String(k).trim(); })
    .filter(function (k) { return k; }).slice(0, 10);

  var out = [];
  cal.getEvents(from, end).forEach(function (ev) {
    var title = ev.getTitle() || '';
    var byColor = !!color && ev.getColor() === color;
    var byKw = kws.some(function (k) { return title.indexOf(k) >= 0; });
    if (!byColor && !byKw) return;
    var allDay = ev.isAllDayEvent();
    var s = allDay ? ev.getAllDayStartDate() : ev.getStartTime();
    var en = allDay ? new Date(ev.getAllDayEndDate().getTime() - 24 * 3600 * 1000) : ev.getEndTime();
    if (en < s) en = s;
    out.push({
      id: ev.getId(),
      recurring: ev.isRecurringEvent(),
      title: title,
      start: fmt_(s, 'yyyy-MM-dd'),
      end: fmt_(en, 'yyyy-MM-dd'),
      startTime: allDay ? null : fmt_(s, 'HH:mm'),
      endTime: allDay ? null : fmt_(en, 'HH:mm'),
      location: String(ev.getLocation() || '').slice(0, 300),
      description: String(ev.getDescription() || '').slice(0, 4000),
      by: byColor ? 'color' : 'keyword'
    });
  });
  return { ok: true, calendar: cal.getName(), events: out };
}

// ---------- 추가 ----------
function add_(cal, d) {
  var title = String(d.title || '').trim().slice(0, 200);
  if (!title) throw new Error('제목이 없어요');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.start || ''))) throw new Error('날짜 형식이 올바르지 않아요');
  var end = /^\d{4}-\d{2}-\d{2}$/.test(String(d.end || '')) ? d.end : d.start;
  var opts = {
    location: String(d.location || '').slice(0, 300),
    description: String(d.description || '').slice(0, 4000)
  };
  var ev;
  if (/^\d{2}:\d{2}$/.test(String(d.startTime || ''))) {
    var s = Utilities.parseDate(d.start + ' ' + d.startTime, TZ, 'yyyy-MM-dd HH:mm');
    var et = /^\d{2}:\d{2}$/.test(String(d.endTime || '')) ? d.endTime : d.startTime;
    var en = Utilities.parseDate(end + ' ' + et, TZ, 'yyyy-MM-dd HH:mm');
    if (en <= s) en = new Date(s.getTime() + 2 * 3600 * 1000);
    ev = cal.createEvent(title, s, en, opts);
  } else {
    var sd = Utilities.parseDate(d.start, TZ, 'yyyy-MM-dd');
    var ed = Utilities.parseDate(end, TZ, 'yyyy-MM-dd');
    if (ed > sd) ev = cal.createAllDayEvent(title, sd, new Date(ed.getTime() + 24 * 3600 * 1000), opts);
    else ev = cal.createAllDayEvent(title, sd, opts);
  }
  var color = colorId_(d.color);
  if (color) ev.setColor(color);
  return { ok: true, id: ev.getId(), title: title };
}

// ---------- 도우미 ----------
function colorId_(c) {
  c = String(c == null ? '' : c);
  return /^(?:[1-9]|1[01])$/.test(c) ? c : '';   // 구글 캘린더 일정 색 1~11
}
function ymd_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? Utilities.parseDate(s, TZ, 'yyyy-MM-dd') : null;
}
function fmt_(dt, f) { return Utilities.formatDate(dt, TZ, f); }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
