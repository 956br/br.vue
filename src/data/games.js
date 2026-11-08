// تصنيفات فلتر الرئيسية — كل لعبة لها cat واحد منها
export const categories = [
  { id: 'luck', label: '🎲 حظ وإقصاء' },
  { id: 'trivia', label: '🧠 ذكاء ومعلومات' },
  { id: 'words', label: '🔤 كلمات وحروف' },
  { id: 'speed', label: '⚡ سرعة وتركيز' },
  { id: 'teams', label: '🤝 فرق' },
];
// قائمة ألعاب الرئيسية (Home.vue)، ومنها ياخذ avatarOrLogo شعار كل لعبة (راجع utils/gameLogo.js)
// cat = التصنيف (من categories فوق)، isNew = تطلع عليها شارة "جديد"
export const games = [
  { slug: 'wheel', cat: 'luck', title: 'عجلة الصامل', img: 'wheel.png', desc: 'عجلة تلف وتختار واحد بس، مين بيكون "الضحية" هالمرة؟' },
  { slug: 'mahdi', cat: 'luck',title: 'عجلة مهدي', img: 'wb.png', desc: 'ندسك والعجلة تصيدك، حاول ما تطرد نفسك.' },
  { slug: 'dice', cat: 'luck', title: 'رمعة نرد', img: 'dice.png', desc: 'النرد بيده، وحظك بيدك، خمّن الرقم واجمع النقاط.' },
  { slug: 'notebook', cat: 'words', title: 'دفتر عبود', img: 'notebook.webp', desc: 'عبود يكتب الأسطر، اكتب كلمتك أسرع واحجز سطرك قبل ما ينشطب اسمك.' },
  { slug: 'unique', cat: 'trivia', title: 'الجواب الفريد "ج"', img: 'unique.webp', desc: 'جاوب بشي ما حد فكر فيه، والفوز لك.' },
  { slug: 'word-builder', cat: 'words', title: 'كوّن كلمة', img: 'word-builder.webp', desc: 'حروف تطلع كل جولة، كوّن منها كلمات بسرعة — أول واحد يكتب الكلمة ياخذ 5 نقاط!' },
  { slug: 'luggage', cat: 'trivia', title: 'وزن الشنطة', img: 'luggage.png', desc: 'قرّب رقمك من وزن الشنطة الحقيقي واكسب.' },
  { slug: 'hex-letters', cat: 'teams', title: 'تحدي الحروف', img: 'hex-letters.webp', desc: 'كل خلية حرف، أسرع جواب ياخذها، ووصّل طريق فريقك للطرف الثاني.' },
  { slug: 'radar', cat: 'luck', title: 'رادار الإقصاء', img: 'radar.png', desc: 'اندس، والرادار ما يرحم.' },
  { slug: 'dark-room', cat: 'speed', title: 'كشف المخبأ', img: 'dark-room.png', desc: 'دوّر على الرقم السري بالشبكة قبل ما يفوتك.' },
  { slug: 'memory-live', cat: 'speed', title: 'الذاكرة', img: 'memory-game.png', desc: 'قلّب البطاقات ولقط المتشابه قبل خصمك.' },
  { slug: 'maze', cat: 'speed', title: 'المتاهة', img: 'maze.png', desc: 'ارسم مسارك واطلع من المتاهة قبل ما الوقت يخلص.' },
  { slug: 'islands', cat: 'luck', title: 'جزر البقاء', img: 'islands.png', desc: 'كل جولة تغرق جزر، وين بتوقف قبل ما يجيك الدور؟' },
  // بطاقة وحدة للنمطين: اختيار "الجميع في واحد" أو "فردي" يطلع بنافذة أول ما تنفتح اللعبة (راجع Apple.vue)
  { slug: 'apple', cat: 'speed', title: 'التقط التفاح', img: 'apple.png', desc: 'شخصية وحدة يحركها الكل، أو كل واحد بشخصيته — مين يلقط تفاح أكثر؟' },
  { slug: 'word-game', cat: 'words', title: 'الكلمة المخفية', img: 'word-game.png', desc: 'كل حرف تصويت، والكلمة تنكشف شوي شوي لين تنعرف.' },
  { slug: 'card', cat: 'speed', title: 'معركة الأرقام', img: 'card.png', desc: 'هجمة ودرع وتخطي، بس واحد يبقى بالآخر.' },
  { slug: 'vault', cat: 'speed', title: 'الخزنة', img: 'vault.png', desc: 'عطيناك المفتاح، افتحها قبل غيرك يفتحها.' },
  { slug: 'ships-mines', cat: 'luck', title: 'المراكب والألغام', img: 'ships-mines.png', desc: 'مراكبكم تمشي وسط الألغام، ياخذكم الحظ لبر الأمان لو لا؟' },
  { slug: 'capitals', cat: 'trivia', title: 'دول وعواصم', img: 'capitals.png', desc: 'عاصمة وحدة وأربع خيارات، تعرفها ولا تتوه؟' },
  { slug: 'dish', cat: 'trivia', title: 'شنو الطبق؟', img: 'dish.png', desc: 'مكونات تنكشف وحدة وحدة، خمّن اسم الطبق قبل الكل.' },
  { slug: 'pipe-race', cat: 'speed', title: 'سباق الأنابيب', img: 'pipe-race.webp', desc: 'تتبع الأنابيب المتشابكة واختر الصح قبل ما الوقت يخلص.' },
  { slug: 'tug', cat: 'teams', title: 'شد الحبل', img: 'tug.png', desc: 'كل فريق يسحب لجهته، مين يغلب بالنهاية؟' },
  // مخفية مؤقتاً حتى إشعار آخر: { slug: 'identity-reveal', title: 'كشف الهوية', img: 'soon.webp', desc: 'مرتبطة ببث تيك توك لايف: سجّل بكتابة إجاباتك الخمس بتعليق واحد، ثم خمّن صاحب التلميحات التي تظهر تباعاً قبل غيرك لتفوز وتكشف هويته!' },
];
