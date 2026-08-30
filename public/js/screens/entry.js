// 진입 화면 — 반·번호·이름만 받고 바로 시작한다.
// 입력값은 브라우저에 저장해 다음 접속 때 자동으로 채운다.

import { classList, GRADE } from '../shared/config.js';

export function createEntryScreen(app) {
  const form = document.getElementById('entryForm');
  const selClass = document.getElementById('inputClass');
  const inputNo = document.getElementById('inputNo');
  const inputName = document.getElementById('inputName');
  const errorBox = document.getElementById('entryError');

  // 빈 항목을 맨 앞에 둬서 아무것도 고르지 않은 상태로 시작한다.
  // 1반이 미리 선택돼 있으면 3반 학생이 그대로 시작해 1반 기록으로 남는다 —
  // 명단을 서버에 두지 않으므로 나중에 걸러낼 방법이 없다.
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '선택';
  selClass.append(blank);

  for (const n of classList()) {
    const option = document.createElement('option');
    option.value = String(n);
    option.textContent = `${n}반`;
    selClass.append(option);
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const classNo = Number(selClass.value);
    const studentNo = Number(inputNo.value);
    const name = inputName.value.trim().replace(/\s+/g, ' ');

    if (!selClass.value) {
      showError('반을 선택해 주세요.');
      selClass.focus();
      return;
    }
    if (!Number.isInteger(studentNo) || studentNo < 1 || studentNo > 45) {
      showError('번호는 1~45 사이 숫자로 입력해 주세요.');
      inputNo.focus();
      return;
    }
    if (!name) {
      showError('이름을 입력해 주세요.');
      inputName.focus();
      return;
    }
    if (!/^[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9 ]+$/.test(name)) {
      showError('이름에는 한글·영문·숫자만 쓸 수 있습니다.');
      inputName.focus();
      return;
    }

    showError('');
    app.setProfile({ grade: GRADE, classNo, studentNo, name });
    app.show('play');
  });

  function onShow() {
    const profile = app.profile;
    if (profile) {
      selClass.value = String(profile.classNo);
      inputNo.value = String(profile.studentNo);
      inputName.value = profile.name;
    }
    showError('');
  }

  return { onShow };
}
