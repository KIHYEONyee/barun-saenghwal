// 앱(Electron)용 저장: 공용 저장 로직(shared/storecore.js)을 앱 데이터 폴더의 JSON 파일(barun-data.json)에 연결
const fs = require('fs');
const path = require('path');
const { StoreCore, DEFAULT_SETTINGS, today, emptyDay } = require('./shared/storecore');

class Store extends StoreCore {
  constructor(dir) {
    const file = path.join(dir, 'barun-data.json');
    super({
      load: () => JSON.parse(fs.readFileSync(file, 'utf8')),
      save: (data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); },
    });
    this.file = file;
  }
}

module.exports = { Store, DEFAULT_SETTINGS, today, emptyDay };
