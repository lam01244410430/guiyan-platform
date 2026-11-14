// Guiyan catalog data — the same 62 resources as the web version.
// Source: guiyan-demo/server/demo-data.mjs (22 items, prices stored as integer
// cents in the original DB, converted here to yuan) + catalog-content.mjs
// (40 items, prices already in yuan). Names, categories, cities, units and
// prices are copied verbatim; only the description is shown in 3 languages.
// No resource was invented. All data is fictional demo data.
var CATS = [
  { id: "show", zh: "演出剧目", vi: "Vở diễn & kịch mục", en: "Shows" },
  { id: "venue", zh: "演出场馆", vi: "Nhà hát & sân khấu", en: "Venues" },
  { id: "artist", zh: "艺人团队", vi: "Nghệ nhân & đoàn diễn", en: "Artists" },
  { id: "equipment", zh: "设备租赁", vi: "Thuê thiết bị", en: "Equipment" },
  { id: "copyright", zh: "版权与IP", vi: "Bản quyền & IP", en: "IP & licensing" },
  { id: "heritage", zh: "非遗体验", vi: "Di sản phi vật thể", en: "Heritage" },
  { id: "creative", zh: "文创衍生", vi: "Văn sáng & quà tặng", en: "Creative goods" },
  { id: "digital", zh: "数字演出", vi: "Diễn số & nhập vai", en: "Digital shows" },
  { id: "tourism", zh: "文旅套餐", vi: "Gói văn–du", en: "Travel packages" },
  { id: "service", zh: "配套服务", vi: "Dịch vụ hỗ trợ", en: "Services" },
  { id: "show-license", zh: "剧目授权", vi: "Ủy quyền kịch mục", en: "Show licensing" }
];

var CITYN = {
  "南宁": { zh: "南宁", vi: "Nam Ninh", en: "Nanning" },
  "柳州": { zh: "柳州", vi: "Liễu Châu", en: "Liuzhou" },
  "桂林": { zh: "桂林", vi: "Quế Lâm", en: "Guilin" },
  "北海": { zh: "北海", vi: "Bắc Hải", en: "Beihai" },
  "崇左": { zh: "崇左", vi: "Sùng Tả", en: "Chongzuo" },
  "河池": { zh: "河池", vi: "Hà Trì", en: "Hechi" },
  "全区": { zh: "全区", vi: "Toàn vùng", en: "Region-wide" }
};

var UNITN = {
  "张": { zh: "张", vi: "vé", en: "ticket" },
  "天": { zh: "天", vi: "ngày", en: "day" },
  "场": { zh: "场", vi: "buổi", en: "session" },
  "人": { zh: "人", vi: "người", en: "person" },
  "件": { zh: "件", vi: "chiếc", en: "item" },
  "份": { zh: "份", vi: "phần", en: "copy" },
  "次": { zh: "次", vi: "lần", en: "session" },
  "项": { zh: "项", vi: "hạng mục", en: "item" }
};

var RES = [
  { name: "广西文化艺术中心", cat: "venue", city: "南宁", price: 12000, unit: "天", views: 120, desc: { zh: "现代化多功能剧场：专业音响灯光、化妆间与观众服务空间，适合歌舞演出、发布会与艺术交流。", vi: "Nhà hát đa năng hiện đại: âm thanh, ánh sáng chuyên nghiệp, phòng hóa trang và không gian phục vụ khán giả — hợp ca múa, lễ ra mắt và giao lưu nghệ thuật.", en: "A modern multi-purpose theatre: pro sound and lighting, dressing rooms and audience spaces — ideal for dance galas, launches and arts exchanges." } },
  { name: "民族歌舞剧《刘三姐》", cat: "show", city: "南宁", price: 280, unit: "张", views: 157, desc: { zh: "取材于山歌与壮族文化的民族歌舞剧，适合家庭观演、团体活动与文旅合作。", vi: "Vở ca múa kịch lấy cảm hứng từ sơn ca và văn hóa Tráng — hợp xem gia đình, hoạt động tập thể và hợp tác văn–du.", en: "A folk song-and-dance drama inspired by mountain songs and Zhuang culture — great for families, group outings and travel tie-ins." } },
  { name: "壮乡情·民族歌舞专场", cat: "show", city: "柳州", price: 198, unit: "张", views: 194, desc: { zh: "融合铜鼓、山歌对唱与集体舞的专场晚会，可整场采购或合作巡演。", vi: "Đêm diễn kết hợp trống đồng, đối ca sơn ca và múa tập thể; có phương án mua vở và lưu diễn hợp tác.", en: "A gala of bronze drums, antiphonal mountain songs and ensemble dance; full-show purchase and touring partnerships available." } },
  { name: "南宁小剧场", cat: "venue", city: "南宁", price: 6000, unit: "天", views: 231, desc: { zh: "灵活的黑匣子空间，适合话剧、脱口秀、沙龙与小型音乐会。", vi: "Không gian hộp đen linh hoạt cho kịch nói, hài độc thoại, salon và hòa nhạc nhỏ.", en: "A flexible black-box space for drama, stand-up, salons and small concerts." } },
  { name: "青年山歌演唱组合", cat: "artist", city: "桂林", price: 3600, unit: "场", views: 268, desc: { zh: "四位青年歌者：山歌对唱与民族歌曲改编，可主持、可定制节目。", vi: "Nhóm 4 ca sĩ trẻ: đối ca sơn ca, cải biên nhạc dân tộc; nhận dẫn chương trình và tiết mục đặt riêng.", en: "Four young singers: antiphonal mountain songs and folk adaptations, with hosting and custom sets on request." } },
  { name: "专业舞台灯光组合", cat: "equipment", city: "南宁", price: 1500, unit: "天", views: 305, desc: { zh: "舞台灯光组合含摇头灯、染色灯与控制台，下单即可预览灯位图与配色。", vi: "Gói đèn sân khấu gồm đèn moving, đèn nhuộm và bàn điều khiển — xem trước sơ đồ đèn và màu ngay khi đặt.", en: "Stage lighting package with moving heads, wash lights and console — preview the light plot and colours as you book." } },
  { name: "移动音响与无线话筒套装", cat: "equipment", city: "北海", price: 800, unit: "天", views: 342, desc: { zh: "小型户外演出移动音响：音箱、调音台、无线话筒与现场安装。", vi: "Âm thanh di động cho diễn ngoài trời nhỏ: loa, mixer, micro không dây và lắp đặt.", en: "Portable PA for small outdoor shows: speakers, mixer, wireless mics and on-site setup." } },
  { name: "刘三姐主题IP授权", cat: "copyright", city: "南宁", price: 8000, unit: "次", views: 379, desc: { zh: "原创演艺形象商业授权：范围、期限与地域清晰明示。", vi: "Trình diễn quy trình cấp phép thương mại hình ảnh diễn nghệ gốc: phạm vi, thời hạn, vùng lãnh thổ rõ ràng.", en: "Commercial licensing for an original stage IP, with scope, term and territory clearly set out." } },
  { name: "花山岩画主题舞美设计", cat: "copyright", city: "崇左", price: 3600, unit: "次", views: 416, desc: { zh: "以本土文化为灵感的舞台美术设计，支持授权申请、合同查看与权利交付。", vi: "Thiết kế mỹ thuật sân khấu lấy cảm hứng văn hóa bản địa; hỗ trợ xin phép, xem hợp đồng và bàn giao quyền.", en: "Stage design inspired by local rock-art culture, with licensing support, contract review and rights delivery." } },
  { name: "壮锦手作与山歌体验", cat: "heritage", city: "南宁", price: 168, unit: "人", views: 453, desc: { zh: "亲手织壮锦纹样、与歌者对唱山歌，适合亲子、研学与团建。", vi: "Trải nghiệm dệt họa tiết Tráng cẩm và giao lưu sơn ca — hợp gia đình, học tập trải nghiệm và team building.", en: "Weave Zhuang brocade patterns and trade songs with singers — perfect for families, school trips and team building." } },
  { name: "咸水歌文化体验", cat: "heritage", city: "北海", price: 128, unit: "人", views: 490, desc: { zh: "听咸水歌、参与互动演唱，了解滨海民俗。", vi: "Nghe hát dân gian vùng biển, hát tương tác và tìm hiểu phong tục ven biển.", en: "Listen to seafarers' folk songs, join the singing and learn coastal customs." } },
  { name: "壮锦纹样帆布袋", cat: "creative", city: "南宁", price: 68, unit: "件", views: 527, desc: { zh: "广西传统纹样帆布袋，下单可查规格与库存；当前库存告急。", vi: "Túi vải họa tiết truyền thống Quảng Tây — xem quy cách và tồn kho ngay khi đặt; số lượng hiện rất ít.", en: "A canvas tote with traditional Guangxi patterns — check specs and stock when ordering; very few left." } },
  { name: "AIGC山歌纪念海报定制", cat: "creative", city: "桂林", price: 29, unit: "份", views: 564, desc: { zh: "选姓名与祝福主题，套用模板即时生成山歌纪念海报。", vi: "Chọn tên và chủ đề chúc phúc để ghép mẫu poster chữ — ghép bằng mẫu có sẵn ngay trên trang.", en: "Pick a name and a blessing theme to compose a mountain-song souvenir poster from ready templates." } },
  { name: "云演播·壮乡舞台精选", cat: "digital", city: "全区", price: 39, unit: "次", views: 601, desc: { zh: "壮乡舞台精选数字点播，随订随看。", vi: "Quyền xem diễn số theo yêu cầu: các tiết mục sân khấu Tráng hương chọn lọc, xem mọi lúc.", en: "On-demand digital performances: a curated selection of Zhuang stage highlights, watch anytime." } },
  { name: "VR山歌剧场体验", cat: "digital", city: "桂林", price: 59, unit: "次", views: 638, desc: { zh: "沉浸式预览互动舞台视角，预约VR山歌剧场体验。", vi: "Xem trước góc nhìn sân khấu tương tác và đặt quyền trải nghiệm VR sơn ca.", en: "Preview an interactive stage viewpoint and book a VR mountain-song theatre experience." } },
  { name: "演艺＋漓江文旅套餐", cat: "tourism", city: "桂林", price: 398, unit: "人", views: 675, desc: { zh: "演出与景点体验组合套餐，个人与团队均可预订。", vi: "Gói kết hợp xem diễn và trải nghiệm danh thắng; nhận đặt riêng cho cá nhân và đoàn.", en: "A bundle of live performance plus scenic experiences; open to individuals and groups." } },
  { name: "滨海音乐会与酒店套餐", cat: "tourism", city: "北海", price: 568, unit: "人", views: 712, desc: { zh: "观演与住宿一站组合，适合周末短途旅行。", vi: "Sản phẩm kết hợp xem diễn và lưu trú cho chuyến đi ngắn cuối tuần.", en: "Performance plus hotel stay in one bundle — made for short weekend trips." } },
  { name: "演出报批咨询对接", cat: "service", city: "南宁", price: 500, unit: "次", views: 749, desc: { zh: "梳理演出类型、场次与主体材料，对接演出报批咨询与材料提交。", vi: "Thu thập loại hình, số suất và hồ sơ chủ thể — tư vấn và hỗ trợ nộp hồ sơ xin phép biểu diễn.", en: "Guidance on performance permit applications: show type, sessions and paperwork, all in one intake." } },
  { name: "东盟演艺合作咨询", cat: "service", city: "南宁", price: 800, unit: "次", views: 786, desc: { zh: "登记跨境演艺合作意向，匹配资源并对接服务机构。", vi: "Đăng ký ý định hợp tác diễn nghệ xuyên biên giới, khớp tài nguyên và nối đơn vị dịch vụ.", en: "Register cross-border performing-arts collaboration intent; we match resources and service partners." } },
  { name: "文旅活动保险咨询", cat: "service", city: "柳州", price: 100, unit: "次", views: 823, desc: { zh: "提交活动保险需求，对接合适的咨询机构。", vi: "Nộp nhu cầu bảo hiểm hoạt động và nối đơn vị tư vấn phù hợp.", en: "Submit your event insurance needs and get matched with the right advisor." } },
  { name: "演艺市场趋势报告", cat: "service", city: "全区", price: 99, unit: "份", views: 860, desc: { zh: "基于平台交易数据整理的演艺市场趋势分析报告。", vi: "Báo cáo phân tích xu hướng thị trường diễn nghệ dựng từ dữ liệu giao dịch của nền tảng.", en: "A performing-arts market trend report built from platform transaction data." } },
  { name: "舞台技术人才与课程", cat: "service", city: "南宁", price: 199, unit: "人", views: 897, desc: { zh: "舞台技术人才对接、用工意向与灯光基础课程预约。", vi: "Giới thiệu nhân lực kỹ thuật sân khấu, ý định tuyển dụng và đặt khóa học ánh sáng cơ bản.", en: "Stage-technician matching, hiring intent and beginner lighting course bookings." } },
  { name: "八桂弦歌·民族室内乐专场", cat: "show", city: "南宁", price: 168, unit: "张", views: 80, desc: { zh: "琵琶、古筝与竹笛在温馨室内乐空间演绎广西山歌。", vi: "Đàn tỳ bà, cổ tranh, sáo trúc diễn tấu sơn ca Quảng Tây trong không gian thính phòng ấm cúng.", en: "Pipa, guzheng and bamboo flute play Guangxi mountain songs in an intimate chamber setting." } },
  { name: "山水之间·桂林民谣音乐会", cat: "show", city: "桂林", price: 128, unit: "张", views: 103, desc: { zh: "山水意境与原创民谣相遇，适合朋友同行与小团包场。", vi: "Ý cảnh sơn thủy gặp dân ca nguyên tác — hợp đi cùng bạn bè và bao rạp nhóm nhỏ.", en: "Landscape moods meet original folk songs — lovely with friends or as a small-group buyout." } },
  { name: "邕城故事·城市小剧场", cat: "show", city: "南宁", price: 98, unit: "张", views: 126, desc: { zh: "老街、骑楼与市井日常，轻喜剧讲城里温暖的相遇。", vi: "Từ phố cổ, nhà cưỡi lầu và đời sống thường ngày — hài kịch nhẹ kể những cuộc gặp ấm áp của thành phố.", en: "Old streets, arcade houses and everyday life — a gentle comedy of warm city encounters." } },
  { name: "铜鼓回响·壮乡舞蹈诗", cat: "show", city: "崇左", price: 228, unit: "张", views: 149, desc: { zh: "铜鼓节奏与民族舞蹈交织的舞台作品，可散购也可团体合作。", vi: "Tác phẩm sân khấu hòa nhịp trống đồng và múa dân tộc; có tư vấn mua lẻ và hợp tác tập thể.", en: "A stage work weaving bronze-drum rhythms with folk dance; single tickets and group partnerships." } },
  { name: "邕江艺术空间·黑匣子剧场", cat: "venue", city: "南宁", price: 4800, unit: "天", views: 103, desc: { zh: "舞台与座席灵活拼搭，适合实验戏剧、主题演出与品牌活动。", vi: "Sân khấu và ghế khán giả ghép linh hoạt — hợp kịch thực nghiệm, đêm diễn chuyên đề và sự kiện thương hiệu.", en: "Modular stage and seating — ideal for experimental theatre, themed nights and brand events." } },
  { name: "漓江畔·山水露天舞台", cat: "venue", city: "桂林", price: 8600, unit: "天", views: 126, desc: { zh: "依山傍水的开放式演出空间，可对接小型实景演出与城市文化活动。", vi: "Không gian diễn mở nép núi kề sông; nối được diễn thực cảnh nhỏ và hoạt động văn hóa thành phố.", en: "An open-air stage between hills and river, ready for small site-specific shows and city culture events." } },
  { name: "柳江青年艺术剧场", cat: "venue", city: "柳州", price: 6500, unit: "天", views: 149, desc: { zh: "灯光、扩声与后台一应俱全，服务青年剧团巡演与文化交流。", vi: "Trang bị ánh sáng, khuếch thanh và hậu đài cơ bản cho đoàn trẻ lưu diễn và giao lưu văn hóa.", en: "Full lighting, sound and backstage basics for young touring troupes and cultural exchanges." } },
  { name: "海风文化客厅·多功能厅", cat: "venue", city: "北海", price: 3600, unit: "天", views: 172, desc: { zh: "适合小型音乐会、艺术沙龙与文创发布，布局随活动调整。", vi: "Hợp hòa nhạc nhỏ, salon nghệ thuật và ra mắt văn sáng; bố trí thay đổi theo hoạt động.", en: "Suited to small concerts, art salons and creative launches, with layouts that adapt per event." } },
  { name: "八桂丝竹·民族器乐组合", cat: "artist", city: "南宁", price: 6800, unit: "场", views: 126, desc: { zh: "民族器乐四重奏，可为音乐厅与文化交流定制曲目。", vi: "Nhóm tứ tấu nhạc cụ dân tộc với phương án tiết mục đặt riêng cho thính phòng và giao lưu văn hóa.", en: "A folk-instrument quartet with custom programmes for concert halls and cultural exchanges." } },
  { name: "柳江青年·民谣乐队", cat: "artist", city: "柳州", price: 4200, unit: "场", views: 149, desc: { zh: "木吉他与人声的轻编制乐队，适合市集、营地与文旅驻场演出。", vi: "Biên chế gọn guitar mộc và giọng hát — hợp chợ phiên, cắm trại và diễn lưu trú không gian văn–du.", en: "A lean acoustic-guitar-and-vocals band for markets, campsites and venue residencies." } },
  { name: "山歌有约·壮乡歌舞团", cat: "artist", city: "崇左", price: 9800, unit: "场", views: 172, desc: { zh: "壮族山歌与传统舞蹈招牌团队，支持节目组合、团体演出与文化体验。", vi: "Đặc sắc sơn ca và múa truyền thống Tráng; hỗ trợ tổ hợp tiết mục, diễn tập thể và trải nghiệm văn hóa.", en: "Signature Zhuang mountain songs and traditional dance, with programme combos, group shows and cultural experiences." } },
  { name: "桂北声场·青年合唱团", cat: "artist", city: "桂林", price: 5800, unit: "场", views: 195, desc: { zh: "适合艺术节、校园交流与公共文化活动，可按主题编排。", vi: "Hợp lễ hội nghệ thuật, giao lưu trường học và hoạt động văn hóa công cộng; biên soạn theo chủ đề.", en: "For arts festivals, school exchanges and public culture events, arranged to your theme." } },
  { name: "小型演出·专业扩声套装", cat: "equipment", city: "南宁", price: 1800, unit: "天", views: 149, desc: { zh: "主扩、返送、调音台与基础布线，适配小剧场与中型活动。", vi: "Loa chính, monitor, mixer và đi dây cơ bản — vừa rạp nhỏ và hoạt động cỡ vừa.", en: "Main PA, monitors, mixer and basic cabling — sized for small theatres and mid-size events." } },
  { name: "舞台氛围·LED灯光套装", cat: "equipment", city: "柳州", price: 1500, unit: "天", views: 172, desc: { zh: "染色灯、面光与控制台，附灯位建议与现场技术对接。", vi: "Đèn nhuộm, đèn mặt và bàn điều khiển; hỗ trợ gợi ý sơ đồ đèn và nối kỹ thuật tại hiện trường.", en: "Wash and front lights plus console, with light-plot advice and on-site tech support." } },
  { name: "户外活动·移动舞台搭建", cat: "equipment", city: "北海", price: 4800, unit: "天", views: 195, desc: { zh: "按现场平面与规模提供模块化舞台与基础围挡方案。", vi: "Sân khấu mô-đun và phương án rào chắn cơ bản theo mặt bằng và quy mô thực tế.", en: "Modular staging and basic barrier plans tailored to your site and scale." } },
  { name: "演出记录·多机位摄录服务", cat: "equipment", city: "桂林", price: 2600, unit: "天", views: 218, desc: { zh: "多机位记录演出与活动花絮，含基础后期，交付方式可商议。", vi: "Ghi hình đa góc cho đêm diễn, hậu trường hoạt động và hậu kỳ cơ bản; hình thức bàn giao thỏa thuận.", en: "Multi-camera recording of shows and behind-the-scenes, with basic post-production." } },
  { name: "八桂纹样·视觉素材授权包", cat: "copyright", city: "全区", price: 680, unit: "项", views: 172, desc: { zh: "灵感取自壮锦与铜鼓的原创视觉素材包，可咨询文创与展陈用法。", vi: "Gói tư liệu thị giác gốc lấy cảm hứng Tráng cẩm và trống đồng — tư vấn dùng cho văn sáng và trưng bày.", en: "An original visual-asset pack inspired by brocade and bronze drums, for products and displays." } },
  { name: "山水舞台·原创配乐使用咨询", cat: "copyright", city: "南宁", price: 1200, unit: "项", views: 195, desc: { zh: "舞台、短视频与文旅原创配乐合作示例，授权范围单独确认。", vi: "Ví dụ hợp tác nhạc nền nguyên tác cho sân khấu, video ngắn và văn–du; phạm vi cấp phép xác nhận riêng.", en: "Original score collaboration examples for stage, short video and travel — licensing scope confirmed case by case." } },
  { name: "数字山水·沉浸视觉内容包", cat: "copyright", city: "桂林", price: 3600, unit: "项", views: 218, desc: { zh: "数字视觉内容包，适用于展陈与舞台背景，附场景适配咨询。", vi: "Tư liệu thị giác số cho trưng bày và nền sân khấu, kèm tư vấn适配 cảnh.", en: "A digital visual content pack for exhibitions and stage backdrops, with scene-fit advice." } },
  { name: "桂风雅集·演出策划文本合作", cat: "copyright", city: "南宁", price: 1800, unit: "项", views: 241, desc: { zh: "围绕广西地域文化的演出脚本与活动策划文本合作。", vi: "Hợp tác kịch bản và kế hoạch hoạt động quanh văn hóa vùng Quảng Tây.", en: "Script and event-planning text collaboration around Guangxi regional culture." } },
  { name: "一梭一锦·壮锦织造体验", cat: "heritage", city: "南宁", price: 298, unit: "人", views: 195, desc: { zh: "认识壮锦纹样与传统织机，亲手完成一件小织物。", vi: "Làm quen họa tiết Tráng cẩm và khung dệt truyền thống, tự tay hoàn thành một sản phẩm dệt nhỏ.", en: "Learn brocade patterns and the traditional loom, and finish a small woven piece of your own." } },
  { name: "指尖绣球·壮乡手作工坊", cat: "heritage", city: "柳州", price: 128, unit: "人", views: 218, desc: { zh: "从配色到穿针，亲手做一只绣球，适合亲子与团体文化活动。", vi: "Từ phối màu đến xâu kim — trải nghiệm làm tú cầu, hợp gia đình và hoạt động văn hóa tập thể.", en: "From colour matching to threading the needle, make your own embroidered ball — great for families and groups." } },
  { name: "竹里有趣·桂北竹编课堂", cat: "heritage", city: "桂林", price: 168, unit: "人", views: 241, desc: { zh: "了解竹材与编法，完成一件可带走的小竹器。", vi: "Tìm hiểu tre và cách đan, hoàn thành một món đồ tre nhỏ mang về.", en: "Get to know bamboo and its weaving, and take home a small finished piece." } },
  { name: "铜鼓与山歌·民俗体验课", cat: "heritage", city: "崇左", price: 198, unit: "人", views: 264, desc: { zh: "以节奏、歌声与故事走近壮乡民俗，适合研学与交流。", vi: "Qua nhịp điệu, tiếng hát và câu chuyện để hiểu phong tục Tráng hương — hợp học tập và giao lưu.", en: "Meet Zhuang folk customs through rhythm, song and story — ideal for study trips and exchanges." } },
  { name: "山歌入梦·壮锦香囊礼盒", cat: "creative", city: "南宁", price: 89, unit: "件", views: 218, desc: { zh: "壮锦纹样香囊礼盒，适合纪念品与活动赠礼。", vi: "Hộp quà túi thơm kết hợp họa tiết Tráng cẩm — hợp làm kỷ niệm và quà tặng sự kiện.", en: "A sachet gift box with brocade patterns — a keepsake or event gift." } },
  { name: "八桂小鼓·铜鼓文创摆件", cat: "creative", city: "河池", price: 168, unit: "件", views: 241, desc: { zh: "铜鼓灵感桌面摆件，为日常空间添一抹地域文化。", vi: "Vật trang trí bàn làm việc lấy cảm hứng trống đồng, điểm nét văn hóa vùng cho không gian hằng ngày.", en: "A bronze-drum-inspired desk ornament that brings regional culture into everyday spaces." } },
  { name: "漓江来信·山水手账套装", cat: "creative", city: "桂林", price: 68, unit: "件", views: 264, desc: { zh: "收纳山水、竹筏与旅途记忆的手账纸品套装。", vi: "Bộ sổ tay và giấy phẩm gói ký ức sơn thủy, bè tre và chuyến đi.", en: "A journal-and-paper set that keeps the mountains, bamboo rafts and the journey itself." } },
  { name: "锦上生花·民族织物随身包", cat: "creative", city: "柳州", price: 158, unit: "件", views: 287, desc: { zh: "民族织物细节随身小包，适合个人赠礼与团体定制。", vi: "Túi nhỏ tiện dụng với chi tiết vải dệt dân tộc — hợp quà cá nhân và đặt riêng tập thể.", en: "A handy pouch with folk-weave details — personal gifts and group custom orders welcome." } },
  { name: "山水入画·沉浸式数字展", cat: "digital", city: "桂林", price: 88, unit: "人", views: 241, desc: { zh: "可步入的数字山水投影空间，光影与声音交织成文化体验。", vi: "Không gian sơn thủy bằng chiếu số để dạo bước, hòa ánh sáng và âm thanh thành trải nghiệm văn hóa.", en: "A walk-in digital landscape of projected mountains and water, woven with light and sound." } },
  { name: "云上八桂·民族艺术线上展", cat: "digital", city: "全区", price: 29, unit: "人", views: 264, desc: { zh: "在线看民族艺术与纹样故事，互动内容延展体验。", vi: "Xem trực tuyến nghệ thuật dân tộc và câu chuyện họa tiết; nội dung tương tác mở rộng trải nghiệm.", en: "Folk art and pattern stories online, with interactive content that extends the visit." } },
  { name: "光影铜鼓·互动艺术体验", cat: "digital", city: "南宁", price: 68, unit: "人", views: 287, desc: { zh: "铜鼓节奏触发影像与光效，传统文化遇见数字媒介。", vi: "Nhịp trống đồng kích hoạt hình ảnh và hiệu ứng sáng — nơi văn hóa truyền thống gặp phương tiện số.", en: "Bronze-drum rhythms trigger visuals and light — traditional culture meets digital media." } },
  { name: "数字舞台·虚拟演艺空间导览", cat: "digital", city: "柳州", price: 49, unit: "人", views: 310, desc: { zh: "虚拟舞台空间导览，讲解演艺技术，适合学生与艺术爱好者。", vi: "Hướng dẫn tham quan sân khấu ảo và kỹ thuật diễn nghệ — hợp học sinh và người yêu nghệ thuật.", en: "A guided tour of a virtual stage and its craft — for students and art lovers." } },
  { name: "漓江暮色·山水与民谣半日游", cat: "tourism", city: "桂林", price: 398, unit: "人", views: 264, desc: { zh: "江畔漫步、山水风光与现场民谣，串成一个慢节奏的桂林午后。", vi: "Nối dạo bộ ven sông, phong cảnh sơn thủy và dân ca trực tiếp thành một buổi chiều Quế Lâm chậm rãi.", en: "A riverside stroll, mountain-water views and live folk songs in one slow Guilin afternoon." } },
  { name: "邕城周末·剧场与老街漫游", cat: "tourism", city: "南宁", price: 268, unit: "人", views: 287, desc: { zh: "漫游老街与城市文化空间，再与朋友共度一个剧场周末夜。", vi: "Dạo phố cổ và không gian văn hóa thành phố rồi đến một đêm diễn cuối tuần cùng bạn bè.", en: "Wander old streets and city culture spaces, then a weekend theatre night with friends." } },
  { name: "海风有约·滨海音乐体验", cat: "tourism", city: "北海", price: 328, unit: "人", views: 310, desc: { zh: "海边散步、落日与现场轻音乐，组成滨海文化体验。", vi: "Tản bộ biển, hoàng hôn và nhạc nhẹ trực tiếp thành trải nghiệm văn hóa ven biển.", en: "A seaside walk, sunset and live light music in one coastal culture experience." } },
  { name: "壮乡寻音·民俗文化研学", cat: "tourism", city: "崇左", price: 468, unit: "人", views: 333, desc: { zh: "山歌、铜鼓故事与手作结合的民俗文化研学行程，有团队方案。", vi: "Hành trình học tập văn hóa kết hợp sơn ca, câu chuyện trống đồng và làm thủ công; có phương án đoàn.", en: "A folk-culture study trip of mountain songs, bronze-drum stories and crafts, with group options." } },
  { name: "小剧场演出·舞台监督服务", cat: "service", city: "南宁", price: 1800, unit: "场", views: 287, desc: { zh: "按项目规模对接排练、舞台流程与现场调度。", vi: "Hỗ trợ nối buổi tập, quy trình sân khấu và điều phối hiện trường theo quy mô dự án.", en: "Stage-management support for rehearsals, show flow and on-site coordination, scaled to your project." } },
  { name: "文化活动·双语主持对接", cat: "service", city: "桂林", price: 1600, unit: "场", views: 310, desc: { zh: "为文化交流、艺术沙龙与文旅活动对接双语主持方案。", vi: "Phương án và nối người dẫn song ngữ cho giao lưu văn hóa, salon nghệ thuật và văn–du.", en: "Bilingual host matching for cultural exchanges, art salons and travel events." } },
  { name: "团体观演·接待与导览服务", cat: "service", city: "柳州", price: 980, unit: "场", views: 333, desc: { zh: "团队签到、观演提醒与文化空间导览的基础服务包。", vi: "Gói dịch vụ cơ bản: điểm danh đoàn, nhắc lịch xem diễn và hướng dẫn không gian văn hóa.", en: "A basics package for groups: check-in, show reminders and cultural-space guiding." } },
  { name: "演出推广·视觉与传播策划", cat: "service", city: "南宁", price: 2800, unit: "场", views: 356, desc: { zh: "含海报方向、内容日历与渠道建议的推广传播合作。", vi: "Hợp tác truyền thông gồm hướng poster, lịch nội dung và gợi ý kênh.", en: "Promotion collaboration covering poster direction, content calendars and channel advice." } }
];

var DEMANDS = [
  { title: { zh: "寻民族歌舞团队，合作城市文化周", vi: "Tìm đoàn ca múa dân tộc cho tuần văn hóa thành phố", en: "Seeking a folk dance troupe for a city culture week" }, cat: "artist", budget: 20000, city: "南宁", desc: { zh: "12月城市文化周，需要30–45分钟民族歌舞节目。", vi: "Tháng 12 tổ chức tuần văn hóa thành phố, cần tiết mục ca múa dân tộc 30–45 phút.", en: "A city culture week in December needs a 30–45 minute folk song-and-dance programme." } },
  { title: { zh: "亲子研学活动，寻找非遗体验资源", vi: "Hoạt động học tập gia đình, tìm trải nghiệm di sản", en: "Family study trip seeks heritage experiences" }, cat: "heritage", budget: 5000, city: "桂林", desc: { zh: "约30人参加，希望有半天手作与民俗体验并配讲解。", vi: "Khoảng 30 người tham gia, muốn nửa ngày thủ công và trải nghiệm dân tục kèm thuyết minh.", en: "About 30 participants want a half-day of crafts and folk experiences with a guide." } },
  { title: { zh: "小剧场巡演合作意向", vi: "Tìm rạp nhỏ cho lưu diễn", en: "Small-theatre touring partnership" }, cat: "venue", budget: 15000, city: "柳州", desc: { zh: "寻找200座以上小剧场巡演，档期与合作方式面议。", vi: "Tìm rạp nhỏ sức chứa trên 200 người cho lưu diễn; lịch và cách hợp tác thương lượng.", en: "Looking for a 200+ seat small theatre for a tour; dates and terms negotiable." } },
  { title: { zh: "企业文化日，寻找民族器乐暖场节目", vi: "Ngày văn hóa doanh nghiệp, tìm tiết mục nhạc cụ dân tộc mở màn", en: "Corporate culture day seeks a folk-instrument opener" }, cat: "artist", budget: 8000, city: "南宁", desc: { zh: "企业文化日需要20–30分钟民族器乐暖场，含基础音响。", vi: "Ngày văn hóa doanh nghiệp cần tiết mục nhạc cụ dân tộc 20–30 phút kèm âm thanh cơ bản.", en: "A corporate culture day needs a 20–30 minute folk-instrument warm-up with basic PA." } },
  { title: { zh: "周末亲子营，招募壮锦与竹编体验老师", vi: "Trại cuối tuần gia đình, tìm thầy dạy Tráng cẩm và đan tre", en: "Weekend family camp seeks brocade & bamboo teachers" }, cat: "heritage", budget: 6000, city: "桂林", desc: { zh: "预计25组家庭，希望有两项手作体验，含材料与指导。", vi: "Dự kiến 25 gia đình, muốn hai trải nghiệm thủ công kèm vật liệu và hướng dẫn.", en: "Around 25 families want two craft experiences with materials and instructors." } },
  { title: { zh: "青年音乐专场，寻找200人以内场地", vi: "Đêm nhạc trẻ, tìm sân dưới 200 chỗ", en: "Youth music night seeks a sub-200 venue" }, cat: "venue", budget: 5000, city: "柳州", desc: { zh: "小型木音乐专场，需要扩声、灯光与基础后台，时间灵活。", vi: "Đêm nhạc mộc nhỏ cần khuếch thanh, ánh sáng và hậu đài cơ bản; thời gian linh hoạt.", en: "A small acoustic night needs PA, lighting and basic backstage; timing flexible." } },
  { title: { zh: "滨海文化市集，征集广西文创好物", vi: "Chợ văn hóa ven biển tuyển sản phẩm văn sáng Quảng Tây", en: "Coastal culture market calls for Guangxi creative goods" }, cat: "creative", budget: 12000, city: "北海", desc: { zh: "滨海文化市集征集广西文创产品，支持小批量试展。", vi: "Chợ văn hóa ven biển tuyển sản phẩm văn sáng Quảng Tây, hỗ trợ trưng bày thử số lượng nhỏ.", en: "A coastal culture market is collecting Guangxi creative products, with small-batch trial display." } },
  { title: { zh: "校园艺术周，寻找数字艺术展陈方案", vi: "Tuần nghệ thuật trường học, tìm phương án triển lãm số", en: "Campus arts week seeks a digital exhibition plan" }, cat: "digital", budget: 18000, city: "南宁", desc: { zh: "希望用沉浸投影与互动导览呈现地域文化。", vi: "Muốn dùng chiếu nhập vai và hướng dẫn tương tác để trình bày văn hóa vùng.", en: "Immersive projection and interactive guiding to present regional culture." } },
  { title: { zh: "文旅小团，寻找山歌与民俗体验资源", vi: "Đoàn văn–du nhỏ, tìm trải nghiệm sơn ca và dân tục", en: "Small travel group seeks song & folk experiences" }, cat: "tourism", budget: 9000, city: "崇左", desc: { zh: "约20人小团，需要山歌、铜鼓与手作结合的行程。", vi: "Đoàn khoảng 20 người cần hành trình kết hợp sơn ca, trống đồng và thủ công.", en: "A group of about 20 wants an itinerary combining mountain songs, bronze drums and crafts." } }
];

function catName(id, lang) {
  for (var i = 0; i < CATS.length; i++) {
    if (CATS[i].id === id) return CATS[i][lang] || CATS[i].zh;
  }
  return id;
}

function cityName(c, lang) {
  return (CITYN[c] && CITYN[c][lang]) || c;
}

function unitName(u, lang) {
  return (UNITN[u] && UNITN[u][lang]) || u;
}

function descOf(r, lang) {
  return (r.desc && r.desc[lang]) || r.desc.zh;
}

function money(n) {
  return '\u00A5' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function withIndex(list) {
  return list.map(function (r, i) { return { r: r, i: i }; });
}

function topViewed(n) {
  return withIndex(RES).sort(function (a, b) { return b.r.views - a.r.views; }).slice(0, n);
}

// Same matching rule as the web version: same category, within budget,
// same city first, then by popularity (views).
function matchDemand(d) {
  var list = withIndex(RES).filter(function (o) {
    return o.r.cat === d.cat && o.r.price <= d.budget;
  });
  list.sort(function (a, b) {
    var ac = a.r.city === d.city ? 0 : 1;
    var bc = b.r.city === d.city ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return b.r.views - a.r.views;
  });
  return list;
}

function searchRes(keyword, cat, city, sort) {
  var kw = (keyword || '').toLowerCase();
  var list = withIndex(RES).filter(function (o) {
    if (cat && cat !== 'all' && o.r.cat !== cat) return false;
    if (city && city !== 'all' && o.r.city !== city) return false;
    if (!kw) return true;
    var hay = (o.r.name + ' ' + o.r.city + ' ' + o.r.desc.zh + ' ' + o.r.desc.vi + ' ' + o.r.desc.en).toLowerCase();
    return hay.indexOf(kw) !== -1;
  });
  if (sort === 'asc') list.sort(function (a, b) { return a.r.price - b.r.price; });
  else if (sort === 'desc') list.sort(function (a, b) { return b.r.price - a.r.price; });
  else if (sort === 'name') list.sort(function (a, b) { return a.r.name.localeCompare(b.r.name, 'zh'); });
  else list.sort(function (a, b) { return b.r.views - a.r.views; });
  return list;
}

module.exports = {
  CATS: CATS, CITYN: CITYN, UNITN: UNITN, RES: RES, DEMANDS: DEMANDS,
  catName: catName, cityName: cityName, unitName: unitName, descOf: descOf,
  money: money, topViewed: topViewed, matchDemand: matchDemand,
  searchRes: searchRes, withIndex: withIndex
};
