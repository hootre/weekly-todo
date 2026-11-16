/**
 * 위클리 → 구글 캘린더 "추가 전용" 연결 (Google Apps Script 웹앱)
 *
 * - 일정 추가(add)만 할 수 있어요. 수정/삭제 코드는 일부러 넣지 않았습니다.
 * - 배포: 배포 > 새 배포 > 유형: 웹 앱 / 실행 사용자: 나 / 액세스 권한: 모든 사용자
 * - 배포 후 나오는 웹 앱 URL(…/exec)을 위클리 설정의 "연결 주소"에 붙여넣으세요.
 * - 일정은 이 스크립트를 배포한 계정의 기본 캘린더에 들어갑니다.
 */
var TZ = 'Asia/Seoul';
var COLORS = { RED: CalendarApp.EventColor.RED, BLUE: CalendarApp.EventColor.BLUE, GREEN: CalendarApp.EventColor.GREEN };

function doGet() {
  return json_({ ok: true, app: 'weekly-todo', mode: 'add-only' });
}

function doPost(e) {
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.action !== 'add') throw new Error('지원하지 않는 요청이에요 (추가만 가능)');
    var title = String(d.title || '').trim().slice(0, 200);
    if (!title) throw new Error('제목이 없어요');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.start || ''))) throw new Error('날짜 형식이 올바르지 않아요');
    var end = /^\d{4}-\d{2}-\d{2}$/.test(String(d.end || '')) ? d.end : d.start;
    var opts = {
      location: String(d.location || '').slice(0, 300),
      description: String(d.description || '').slice(0, 4000)
    };
    var cal = CalendarApp.getDefaultCalendar();
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
    if (COLORS[d.color]) ev.setColor(COLORS[d.color]);
    return json_({ ok: true, id: ev.getId(), title: title });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
