// Japanese — for Tokyo, which is where this genre came from.
//
// The one language here with a native tradition of exactly this scene, and it shows in the writing:
// Japanese kaiju films have their own register for soldiers under fire — clipped, formal to the
// officer, full of 撃て and 退がるな — and these are written in that register rather than as English
// with Japanese words. Several land shorter than the English, which is correct; Japanese shouting is
// compressed.
//
// The Marine Corps lines become the JSDF (自衛隊), which is who defends Tokyo in every one of those
// films. "SEMPER FI" has no equivalent motto, so it becomes 覚悟はいいか — the thing that gets
// shouted in its place.
//
// TWO THINGS THIS FILE NEEDS FROM THE RENDERER, both declared in kaijuShoutLang: a font stack that
// contains kana and kanji (Comic Sans has neither, and the bubbles would be empty boxes), and
// permission to break lines BETWEEN CHARACTERS. Japanese has no spaces, so a wrap-at-spaces routine
// finds no break point in a fifteen-character sentence, decides it does not fit at any size, and
// shrinks the whole shout to the minimum font.
//
// Index-aligned with SHOUTS in kaijuShouts.ts.

export const JA_SHOUTS: string[] = [
  '撃て！撃ちまくれ！',                                          // 1
  'でかすぎるだろ、あの#$@%野郎！',
  '海へ帰れ、化け物！',
  '弾込める！援護しろ！',
  '弱点がある。探せ！',
  '膝を狙え！でかい奴ほど派手に倒れる！',
  'こんな任務、聞いてないぞ！',
  '線を死守しろ！@#$%、下がるな！',
  '軍曹、こっち見てます…こっち見てますよ！',
  '選ぶ街を間違えたな！',                                        // 10
  '伏せろ！爆発するぞ！',
  '走れ、走れ、走れ！',
  '目玉に当てたら五千円もらうぞ！',
  '帰れ、見世物が！',
  '今日は誰も死なせない！',
  '戦車をよこせ！十輌だ！',
  '奪われた全員のぶん、撃ち込め！',
  '焦げ臭くないか？俺はこの匂いが大好きでね。',
  '踏みとどまれ！あいつだって血を流す！',
  '動きが鈍ってきた！効いてるぞ！',                              // 20
  '覚悟はいいか、この#$@%が！！！',
  'オラァ！くらえ！',
  '鉛を食らえ、このゴミくずが！',
  '自衛隊は逃げん！',
  '踊りたいか？付き合ってやる、でかいの！',
  'ここは俺の街だ、このクソでかいのが！',
  '工夫しろ！適応しろ！顔面を吹き飛ばせ！',
  '陸上自衛隊に挨拶しろ！',
  '来い、でかぶつ！取りに来い！',
  '隊員は諦めん！立って撃て！',                                  // 30
  '誰もお前を好きじゃない！誰も呼んでない！',
  'もうすぐ神様に会える。笑われるぞ、その顔じゃ！',
  '声が小さい！腹から出せ！',
  '休暇中にもっとひどいのを見た！',
  'それだけか？のろまな肉の塊が！',
  'うおおお！引き裂け、野郎ども！',
  'あの醜いのを焼き払え！',
  'おい！ブサイク！こっちだ！そう、お前だ！',
  '真っ先に戦い、最後まで退かん！',
  '来る惑星を間違えたな、まぬけ！',                              // 40
  '撃ち続けろ！腹をすかせてるぞ！',
  '防弾じゃない！ひるむのを見た！',
  '我慢しろ、坊や！かすり傷だ！',
  'あと二本で石を投げるしかないぞ！',
  '痛みは弱さが抜ける音だ！あいつの顔も抜けろ！',
  '立て！立て！泣くのは後だ！',
  '誰かもっとでかいのを持ってこい！',
  'もっとでかい銃がいる。ずっとでかいのが。',
  '今どっちが赤ん坊だ？今どっちが泣いてる？',
  '下がるな！一歩たりとも下がるな！',                            // 50
  '聞こえるか、ブサイク？これが俺たち全員の銃の音だ！',
  '母さんは逃げる子に育てなかった！',
  '食らいつけ！息をつかせるな！',
  '俺が死んだら、元カノにまだ嫌いだと伝えてくれ！',
  '援護射撃！派手にやれ！',
  'そうだ、まぬけ！ついて来い！',
  '醜くて、のろまで、もうすぐ死ぬ！',
  '腹から声を出せ！',
  '俺の当直では許さん！俺の街では許さん！今日は許さん！',
  '守り抜くか、誰も家に帰れないかだ！',                          // 60

  // --- the forty written to echo the famous ones without lifting them ---------------------------
  'ならば来い、くれてやる！',
  '始めようか、でかいの！',
  'おやすみを言え、ブサイク！',
  'そうだ！お前に言ってるんだ！',
  'こんなにでかいとは聞いてないぞ！',
  '油断するな、全員！',
  '軍曹、こいつは嫌な予感がします！',
  'どうだ、今の気分は！？',
  '彼女から離れろ、この化け物が！',
  '見せてみろ、お前の力を！',                                    // 70
  'それで全部か！？それだけか！？',
  '地球へようこそ、たわけ！',
  'この仕事が大好きだ。この仕事が大嫌いだ。',
  '援軍が来たぞ！',
  'もっとでかい墓がいるな。',
  'もう一発！動かなくなるまで撃て！',
  '今日は戦う！明日は飲む！',
  'ヘリへ走れ！全機だ！',
  'ここで終わりだ。ちょうどここでな。',
  '手を出す惑星を間違えたな！',                                  // 80
  '大砲を叩き起こせ！',
  '血を流してる暇はない！',
  '装填しろ。狩りの季節だ。',
  '殺せないと言っていた。嘘だったな。',
  '血を流すなら、殺せる！',
  '何かに掴まれ！戻ってくるぞ！',
  'とんでもなく醜い野郎だ！',
  '隊長、叫ぶ許可を！',
  '最後まで戦って倒れたと伝えてくれ！',
  'もうこいつには我慢ならん！',                                  // 90
  '這い出てきた穴へ送り返せ！',
  '俺たちは退かない。弾を込め直すだけだ。',
  '立て、隊員！まだ終わってない！',
  '一発でいい。それだけあればいい。',
  '日を間違え、街を間違え、部隊を間違えたな。',
  '笑え、このでかいブサイクが！',
  '俺たちが最終防衛線だ。後ろには誰もいない。',
  '忘れられない土産をくれてやれ！',
  '撃て！ありったけ撃ち込め！',
  '倒れる！本当に倒れるぞ！',                                    // 100
];
