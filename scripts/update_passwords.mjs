// パスワード一括更新スクリプト（平文パスワードを保存）
const WRITE_USER_URL = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com/users";
const READ_USER_URL = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com/users";

const passwordData = [
    { name: "眞葛 澪", loginId: "aria2022", password: "0309" },
    { name: "黒宮 悠太", loginId: "ariaacc", password: "2203" },
    { name: "斉藤 七海", loginId: "nnn0703", password: "0403" },
    { name: "伊藤 麻哉", loginId: "asaya62", password: "6002" },
    { name: "小河原 愛実", loginId: "omg", password: "0000" },
    { name: "平山 士穏", loginId: "1", password: "1111" },
    { name: "加藤 朝陽", loginId: "asahi", password: "0606" },
    { name: "小河原 豪", loginId: "go", password: "5555" },
    { name: "黒木 統丞", loginId: "0001", password: "0001" },
    { name: "西川 菜緒", loginId: "adgj1111", password: "1111" },
    { name: "小野 麻梨花", loginId: "202212", password: "6010" },
    { name: "島田 絢菜", loginId: "toya", password: "0822" },
    { name: "冨工 元晴", loginId: "ariatomiku", password: "0914" },
    { name: "山口 紘生", loginId: "24", password: "5555" },
    { name: "藪中 悠太", loginId: "yyabunakaad1", password: "5578" },
    { name: "北川 祐人", loginId: "kitagawayuto", password: "1903" },
    { name: "長田 明香里", loginId: "akari0404", password: "0044" },
    { name: "山本 拓実", loginId: "0511", password: "1255" },
    { name: "佐々木 幸隆", loginId: "sinbad24", password: "0122" },
    { name: "髙木 最哉", loginId: "t318", password: "0318" },
    { name: "丸岡 美月", loginId: "mizuki0723", password: "0723" },
    { name: "柳下 啓志", loginId: "yanashitakeishi", password: "0501" },
    { name: "重野 太紀", loginId: "taiki56", password: "5453" },
    { name: "藤井 柾志", loginId: "wees", password: "2704" },
    { name: "平松 菜織", loginId: "235506", password: "0618" },
    { name: "柳 有綺", loginId: "p", password: "3098" },
    { name: "井本 莉緒", loginId: "imo", password: "0709" },
    { name: "伊佐 有希", loginId: "aria1313", password: "3913" },
    { name: "梶原 佑太", loginId: "kajyu512", password: "6024" },
    { name: "山田 有輝奈", loginId: "sena0711", password: "0711" },
    { name: "川嶋 恭志郎", loginId: "jxxmp117", password: "1212" },
    { name: "内田 大貴", loginId: "uchidai", password: "0301" },
    { name: "土屋 沙織", loginId: "sssk2833", password: "1015" },
    { name: "平松 陽和", loginId: "hiyo1228", password: "1111" },
    { name: "石橋 直弥", loginId: "nao5454", password: "1484" },
    { name: "須田 雄大", loginId: "Yudai", password: "0727" },
    { name: "原 凜成", loginId: "rinsei", password: "0306" },
    { name: "橋本 ひなた", loginId: "hinata1127", password: "2525" },
    { name: "庵原 咲南", loginId: "aria0906", password: "0714" },
    { name: "江刺家 仁実", loginId: "esa951", password: "1214" },
    { name: "梅屋 礼", loginId: "akira0517", password: "0517" },
    { name: "高橋 優希", loginId: "youki.0079", password: "0320" },
    { name: "安藤 祐貴", loginId: "yukian0505", password: "0449" },
    { name: "吉田 匡希", loginId: "ymasaki0621", password: "3536" },
    { name: "赤穂 佳弘", loginId: "ako", password: "4416" },
    { name: "楠 海音", loginId: "kurukurukun", password: "0331" },
    { name: "河内 顕", loginId: "0933c", password: "0933" },
    { name: "後藤 綾菜", loginId: "510", password: "2424" },
    { name: "市川 美羽", loginId: "miu0319", password: "0319" },
    { name: "中崎 優人", loginId: "nakazaki", password: "0000" },
    { name: "赤津 優大", loginId: "yudai1108", password: "1108" },
    { name: "溝口 哲太", loginId: "tettamizo", password: "2953" },
    { name: "洪 潤太", loginId: "hyt41403", password: "0414" },
    { name: "池 賢秀", loginId: "hyonsu0311", password: "0311" },
    { name: "岩佐 康祐", loginId: "iwasa0901", password: "0510" },
    { name: "広瀬 チアーゴ 清幸", loginId: "thiago1401", password: "1401" },
    { name: "原 雅也", loginId: "aria102414", password: "0121" },
    { name: "黒岡 響生", loginId: "hibiki0012", password: "9609" },
    { name: "三富 凜梨花", loginId: "riri124", password: "0124" },
    { name: "奈良 歩美", loginId: "ayumi0510", password: "0510" },
    { name: "ギジェルモ", loginId: "guillelju1", password: "2911" },
    { name: "髙田 祥太朗", loginId: "shotarotakada", password: "0108" },
    { name: "水谷 泰智", loginId: "osu2026", password: "0423" },
    { name: "竹中 勇馬", loginId: "77", password: "0315" },
    { name: "高木 風 ナシーム", loginId: "nasimtakaki", password: "0929" },
    { name: "三浦 あま音", loginId: "ama722", password: "0306" },
    { name: "米山 拓哉", loginId: "takutaku303", password: "0721" },
    { name: "三浦 夢大", loginId: "mudai0825", password: "0825" },
    { name: "渡辺 快", loginId: "kaiwtnb66", password: "6666" },
    { name: "相場 大知", loginId: "daichi0502", password: "0502" },
    { name: "足立 慎吾", loginId: "adachi0512", password: "9110" },
    { name: "渡邉 瑛太", loginId: "eitaw0320", password: "1061" },
    { name: "西塚 エマ", loginId: "emma", password: "0428" },
    { name: "鈴木 由里香", loginId: "yuri0713", password: "0713" },
    { name: "嶋中美波", loginId: "moomin10", password: "4211" },
    // 既存ユーザー（パスワード追加）
    { name: "関口 雅稀", loginId: "MasatokiSekiguchi", password: "4011" },
    { loginId: "kitagawayuto", password: "1903" },
    { loginId: "akari0404", password: "0044" },
    { loginId: "sinbad24", password: "0122" },
    { loginId: "0511", password: "1255" },
    { loginId: "t318", password: "0318" },
    { loginId: "mizuki0723", password: "0723" },
    { loginId: "yanashitakeishi", password: "0501" },
    { loginId: "taiki56", password: "5453" }
];

// loginIdでパスワードマップを作成
const passwordMap = {};
passwordData.forEach(p => {
    passwordMap[p.loginId] = p.password;
});

async function updatePasswords() {
    console.log("ユーザー一覧を取得中...\n");

    // まず既存ユーザーを取得
    const res = await fetch(READ_USER_URL);
    const data = await res.json();

    let users = [];
    if (data.items) users = data.items;
    else if (data.Items) users = data.Items;
    else if (Array.isArray(data)) users = data;

    console.log(`${users.length}人のユーザーが見つかりました\n`);

    let successCount = 0;
    let skipCount = 0;

    for (const user of users) {
        const pw = passwordMap[user.loginId];

        if (!pw) {
            console.log(`⏭️ ${user.loginId}: パスワード情報なし（スキップ）`);
            skipCount++;
            continue;
        }

        try {
            // 既存のユーザー情報を保持しつつ、passwordDisplayフィールドを追加
            const payload = {
                ...user,
                passwordDisplay: pw  // 表示用パスワード（平文）
            };

            const res = await fetch(WRITE_USER_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                console.log(`✅ ${user.loginId} (${user.lastName || ""} ${user.firstName || ""}): passwordDisplay更新成功`);
                successCount++;
            } else {
                console.log(`❌ ${user.loginId}: エラー ${res.status}`);
            }

            // レート制限対策
            await new Promise(r => setTimeout(r, 100));

        } catch (err) {
            console.log(`❌ ${user.loginId}: ${err.message}`);
        }
    }

    console.log(`\n完了: 更新 ${successCount}件, スキップ ${skipCount}件`);
}

updatePasswords();
