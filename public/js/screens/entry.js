// 진입 화면 — 반·번호·이름만 받고 바로 시작한다.
// 입력값은 브라우저에 저장해 다음 접속 때 자동으로 채운다.

import { classList, GRADE } from '../shared/config.js';

export function createEntryScreen(app) {
  const form = document.getElementById('entryForm');
  const selClass = document.getElementById('inputClass');
  const inputNo = document.getElementById('inputNo');
  const inputName = document.getElementById('inputName');
  const errorBox = document.getElementById('entryError');

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
