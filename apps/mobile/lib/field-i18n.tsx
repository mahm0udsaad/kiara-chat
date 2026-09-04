import { createContext, type PropsWithChildren, use, useMemo } from "react";
import type { FlexStyle, TextStyle } from "react-native";

import type { FieldOrderAction, TripType } from "@/types/api";

export const FIELD_LOCALES = ["ar", "id", "fil", "ru", "am"] as const;
export type FieldLocale = (typeof FIELD_LOCALES)[number];

const arabic = {
  preparingAccount: "جارٍ تجهيز حسابك…",
  prepareAccountError: "تعذر تجهيز الحساب",
  myOrders: "طلباتي",
  orderDetails: "تفاصيل الطلب",
  account: "الحساب",
  loading: "جارٍ التحميل…",
  retry: "إعادة المحاولة",
  cancel: "رجوع",
  confirm: "تأكيد",
  today: "اليوم",
  upcoming: "القادمة",
  previous: "السابقة",
  completedTab: "المكتملة",
  noTodayTitle: "لا توجد طلبات اليوم",
  noTodayDetail: "ستظهر طلبات اليوم هنا فور إسنادها لك.",
  noUpcomingTitle: "لا توجد طلبات قادمة",
  noUpcomingDetail: "لا توجد رحلات مجدولة بعد اليوم.",
  noPreviousTitle: "لا توجد طلبات سابقة",
  noPreviousDetail: "لا توجد طلبات أقدم في سجلك.",
  noCompletedTitle: "لا توجد طلبات مكتملة",
  noCompletedDetail: "تظهر هنا الطلبات بعد تأكيد عودة السائق.",
  openOrder: "فتح طلب {customer}",
  completed: "مكتمل",
  waitingForYou: "بانتظارك",
  inProgress: "قيد التنفيذ",
  orderFinished: "تم إنهاء الطلب",
  hello: "أهلًا {name}",
  ordersGuidance: "افتحي الطلب واتّبعي الخطوة الظاهرة فقط.",
  filterOrders: "تصفية طلباتي",
  loadingOrders: "جارٍ تحميل الطلبات…",
  ordersLoadError: "تعذر تحميل الطلبات",
  stepConfirmRide: "تأكيد الرحلة",
  stepPickup: "ركوب الأخصائية",
  stepStartService: "بدء الخدمة",
  stepCompleteService: "إنهاء الخدمة",
  stepDriverReturn: "عودة السائق",
  managementNotes: "ملاحظات الإدارة",
  customerDoor: "باب العميلة",
  customerDoorPhoto: "صورة باب العميلة",
  stopListening: "إيقاف الاستماع",
  listenToNote: "الاستماع للملاحظة",
  managementVoiceNote: "ملاحظة صوتية من الإدارة",
  loadingOrder: "جارٍ تحميل الطلب…",
  orderLoadError: "تعذر تحميل الطلب",
  orderNotFound: "الطلب غير موجود",
  customer: "العميلة",
  waitingNextStep: "بانتظار الخطوة التالية",
  orderDetailsSection: "تفاصيل الطلب",
  appointment: "الموعد",
  serviceDuration: "مدة الخدمة",
  tripType: "نوع الرحلة",
  oneWay: "ذهاب فقط",
  roundTrip: "ذهاب وعودة",
  customerLocation: "موقع العميلة",
  openLocation: "فتح الموقع",
  mapLocation: "موقع على الخريطة",
  orderTeam: "فريق الطلب",
  specialist: "الأخصائية",
  driver: "السائق",
  unassignedFeminine: "غير محددة",
  unassignedMasculine: "غير محدد",
  automaticReminder: "إذا بقيت الخطوة المطلوبة دون تفاعل لمدة 30 دقيقة فسيصل تذكير تلقائي.",
  driverArrived: "وصلت لمقر الأخصائية",
  confirmStep: "تأكيد الخطوة",
  actionFailed: "تعذر حفظ الخطوة. تحققي من الاتصال ثم أعيدي المحاولة.",
  notifications: "الإشعارات",
  enabled: "مفعّلة",
  disabled: "غير مفعّلة",
  checkingNotifications: "جارٍ التحقق من حالة الإشعارات…",
  sendTestNotification: "إرسال إشعار اختبار",
  enableNotifications: "تفعيل الإشعارات",
  notificationRegistered: "الإشعارات مفعّلة على هذا الجهاز.",
  notificationMuted: "الإشعارات موقوفة على هذا الجهاز باختيارك.",
  notificationSimulator: "الإشعارات لا تعمل على المحاكي. جرّبي على جهاز حقيقي.",
  notificationUnsupported: "الإشعارات غير مدعومة في هذه النسخة التجريبية.",
  notificationNoProject: "إعداد الإشعارات غير مكتمل.",
  notificationDenied: "الإشعارات محظورة. فعّليها من إعدادات الجهاز ثم أعيدي المحاولة.",
  notificationFailed: "تعذّر تفعيل الإشعارات.",
  pushWorksTitle: "الإشعارات تعمل",
  pushWorksBody: "تم تسليم إشعار الاختبار إلى هذا الجهاز.",
  pushSentTitle: "تم إرسال الاختبار",
  pushSentBody: "تم قبول الإشعار، لكن تأكيد التسليم لم يظهر بعد. انتظري قليلًا.",
  pushMissingTitle: "لم يصل الاختبار",
  pushNoToken: "لا يوجد رمز إشعارات مسجل لهذا الجهاز. أعيدي تفعيل الإشعارات أولًا.",
  pushRejected: "رفضت خدمة الإشعارات الطلب.",
  pushTestError: "تعذر اختبار الإشعارات",
  roleSpecialist: "أخصائية",
  roleDriver: "سائق",
  appLanguage: "لغة التطبيق",
  legalSupport: "القانونية والدعم",
  privacy: "الخصوصية",
  privacyPolicy: "سياسة الخصوصية",
  openPrivacy: "فتح سياسة الخصوصية",
  terms: "الشروط",
  termsOfUse: "شروط استخدام التطبيق",
  openTerms: "فتح شروط الاستخدام",
  help: "المساعدة",
  technicalSupport: "الدعم الفني",
  openSupport: "فتح صفحة الدعم الفني",
  logout: "تسجيل الخروج",
  logoutBody: "سيتم إغلاق الجلسة على هذا الجهاز.",
  unknownError: "خطأ غير معروف",
  todayRelative: "اليوم",
  tomorrowRelative: "غدًا",
  yesterdayRelative: "أمس",
  confirmRideTitle: "تأكيد الرحلة والانطلاق",
  confirmRideBody: "أؤكد أنني انطلقت لاصطحاب الأخصائية.",
  driverArrivedTitle: "وصلت لمقر الأخصائية",
  driverArrivedBody: "سيتم تنبيه الأخصائية بوصولك الآن.",
  confirmPickupTitle: "ركبتُ مع السائق",
  confirmPickupBody: "أؤكد ركوبي مع السائق والتوجه إلى العميلة.",
  startServiceTitle: "بدء الخدمة",
  startServiceBody: "أؤكد وصولي إلى منزل العميلة وبدء الخدمة الآن.",
  completeOrderTitle: "إنهاء الخدمة والمغادرة",
  completeOrderBody: "أؤكد انتهاء الخدمة ومغادرتي منزل العميلة.",
  driverReturnTitle: "إنهاء الرحلة والعودة",
  driverReturnBody: "أؤكد عودتي وإتمام رحلة هذا الطلب.",
} as const;

type TranslationKey = keyof typeof arabic;
type Dictionary = Record<TranslationKey, string>;

const indonesian: Dictionary = {
  preparingAccount: "Menyiapkan akun Anda…", prepareAccountError: "Akun tidak dapat disiapkan",
  myOrders: "Pesanan Saya", orderDetails: "Rincian Pesanan", account: "Akun", loading: "Memuat…",
  retry: "Coba lagi", cancel: "Kembali", confirm: "Konfirmasi", today: "Hari ini", upcoming: "Mendatang",
  previous: "Sebelumnya", completedTab: "Selesai", noTodayTitle: "Tidak ada pesanan hari ini",
  noTodayDetail: "Pesanan hari ini akan muncul di sini setelah ditugaskan kepada Anda.",
  noUpcomingTitle: "Tidak ada pesanan mendatang", noUpcomingDetail: "Tidak ada perjalanan yang dijadwalkan setelah hari ini.",
  noPreviousTitle: "Tidak ada pesanan sebelumnya", noPreviousDetail: "Belum ada pesanan lama dalam riwayat Anda.",
  noCompletedTitle: "Tidak ada pesanan selesai", noCompletedDetail: "Pesanan muncul di sini setelah pengemudi mengonfirmasi perjalanan pulang.",
  openOrder: "Buka pesanan {customer}", completed: "Selesai", waitingForYou: "Menunggu Anda", inProgress: "Sedang berjalan",
  orderFinished: "Pesanan selesai", hello: "Halo {name}", ordersGuidance: "Buka pesanan dan ikuti langkah yang ditampilkan.",
  filterOrders: "Filter pesanan saya", loadingOrders: "Memuat pesanan…", ordersLoadError: "Pesanan tidak dapat dimuat",
  stepConfirmRide: "Konfirmasi perjalanan", stepPickup: "Penjemputan spesialis", stepStartService: "Mulai layanan",
  stepCompleteService: "Selesaikan layanan", stepDriverReturn: "Pengemudi kembali", managementNotes: "Catatan manajemen",
  customerDoor: "Pintu pelanggan", customerDoorPhoto: "Foto pintu pelanggan", stopListening: "Hentikan audio",
  listenToNote: "Dengarkan catatan", managementVoiceNote: "Pesan suara dari manajemen", loadingOrder: "Memuat pesanan…",
  orderLoadError: "Pesanan tidak dapat dimuat", orderNotFound: "Pesanan tidak ditemukan", customer: "Pelanggan",
  waitingNextStep: "Menunggu langkah berikutnya", orderDetailsSection: "Rincian pesanan", appointment: "Waktu janji",
  serviceDuration: "Durasi layanan", tripType: "Jenis perjalanan", oneWay: "Sekali jalan", roundTrip: "Pulang-pergi",
  customerLocation: "Lokasi pelanggan", openLocation: "Buka lokasi", mapLocation: "Lokasi di peta", orderTeam: "Tim pesanan",
  specialist: "Spesialis", driver: "Pengemudi", unassignedFeminine: "Belum ditentukan", unassignedMasculine: "Belum ditentukan",
  automaticReminder: "Pengingat otomatis akan dikirim jika langkah yang diperlukan tidak dilakukan selama 30 menit.",
  driverArrived: "Saya sudah tiba di lokasi spesialis", confirmStep: "Konfirmasi langkah",
  actionFailed: "Langkah tidak dapat disimpan. Periksa koneksi lalu coba lagi.", notifications: "Notifikasi", enabled: "Aktif",
  disabled: "Tidak aktif", checkingNotifications: "Memeriksa status notifikasi…", sendTestNotification: "Kirim notifikasi uji",
  enableNotifications: "Aktifkan notifikasi", notificationRegistered: "Notifikasi aktif di perangkat ini.",
  notificationMuted: "Notifikasi dimatikan di perangkat ini.", notificationSimulator: "Notifikasi tidak bekerja di simulator. Gunakan perangkat fisik.",
  notificationUnsupported: "Notifikasi tidak didukung pada versi uji ini.", notificationNoProject: "Pengaturan notifikasi belum lengkap.",
  notificationDenied: "Notifikasi diblokir. Aktifkan di pengaturan perangkat lalu coba lagi.", notificationFailed: "Notifikasi tidak dapat diaktifkan.",
  pushWorksTitle: "Notifikasi berfungsi", pushWorksBody: "Notifikasi uji telah diterima di perangkat ini.",
  pushSentTitle: "Tes telah dikirim", pushSentBody: "Notifikasi diterima oleh layanan, tetapi pengiriman belum dikonfirmasi. Tunggu sebentar.",
  pushMissingTitle: "Tes belum diterima", pushNoToken: "Tidak ada token notifikasi untuk perangkat ini. Aktifkan ulang notifikasi terlebih dahulu.",
  pushRejected: "Layanan notifikasi menolak permintaan.", pushTestError: "Notifikasi tidak dapat diuji", roleSpecialist: "Spesialis",
  roleDriver: "Pengemudi", appLanguage: "Bahasa aplikasi", legalSupport: "Hukum dan dukungan", privacy: "Privasi",
  privacyPolicy: "Kebijakan privasi", openPrivacy: "Buka kebijakan privasi", terms: "Ketentuan", termsOfUse: "Ketentuan penggunaan aplikasi",
  openTerms: "Buka ketentuan penggunaan", help: "Bantuan", technicalSupport: "Dukungan teknis", openSupport: "Buka halaman dukungan",
  logout: "Keluar", logoutBody: "Sesi di perangkat ini akan ditutup.", unknownError: "Kesalahan tidak diketahui",
  todayRelative: "Hari ini", tomorrowRelative: "Besok", yesterdayRelative: "Kemarin",
  confirmRideTitle: "Konfirmasi keberangkatan", confirmRideBody: "Saya mengonfirmasi bahwa saya telah berangkat untuk menjemput spesialis.",
  driverArrivedTitle: "Tiba di lokasi spesialis", driverArrivedBody: "Spesialis akan diberi tahu bahwa Anda telah tiba.",
  confirmPickupTitle: "Saya sudah bersama pengemudi", confirmPickupBody: "Saya mengonfirmasi telah dijemput dan sedang menuju pelanggan.",
  startServiceTitle: "Mulai layanan", startServiceBody: "Saya mengonfirmasi telah tiba di rumah pelanggan dan memulai layanan.",
  completeOrderTitle: "Selesaikan layanan dan pergi", completeOrderBody: "Saya mengonfirmasi layanan selesai dan saya meninggalkan rumah pelanggan.",
  driverReturnTitle: "Selesaikan perjalanan pulang", driverReturnBody: "Saya mengonfirmasi telah kembali dan menyelesaikan perjalanan pesanan ini.",
};

const filipino: Dictionary = {
  preparingAccount: "Inihahanda ang iyong account…", prepareAccountError: "Hindi maihanda ang account",
  myOrders: "Aking mga Order", orderDetails: "Detalye ng Order", account: "Account", loading: "Naglo-load…",
  retry: "Subukan muli", cancel: "Bumalik", confirm: "Kumpirmahin", today: "Ngayon", upcoming: "Paparating",
  previous: "Nakaraan", completedTab: "Tapos na", noTodayTitle: "Walang order ngayong araw",
  noTodayDetail: "Lalabas dito ang mga order kapag naitalaga na sa iyo.", noUpcomingTitle: "Walang paparating na order",
  noUpcomingDetail: "Walang nakaiskedyul na biyahe pagkatapos ng araw na ito.", noPreviousTitle: "Walang nakaraang order",
  noPreviousDetail: "Wala pang mas lumang order sa iyong talaan.", noCompletedTitle: "Walang natapos na order",
  noCompletedDetail: "Lalabas dito ang mga order matapos kumpirmahin ng driver ang pagbabalik.", openOrder: "Buksan ang order ni {customer}",
  completed: "Tapos na", waitingForYou: "Naghihintay sa iyo", inProgress: "Isinasagawa", orderFinished: "Tapos na ang order",
  hello: "Kumusta {name}", ordersGuidance: "Buksan ang order at sundin lamang ang ipinapakitang hakbang.",
  filterOrders: "I-filter ang aking mga order", loadingOrders: "Nilo-load ang mga order…", ordersLoadError: "Hindi ma-load ang mga order",
  stepConfirmRide: "Kumpirmahin ang biyahe", stepPickup: "Pagsakay ng specialist", stepStartService: "Simulan ang serbisyo",
  stepCompleteService: "Tapusin ang serbisyo", stepDriverReturn: "Pagbalik ng driver", managementNotes: "Mga tala ng pamamahala",
  customerDoor: "Pinto ng customer", customerDoorPhoto: "Larawan ng pinto ng customer", stopListening: "Ihinto ang pakikinig",
  listenToNote: "Pakinggan ang tala", managementVoiceNote: "Voice note mula sa pamamahala", loadingOrder: "Nilo-load ang order…",
  orderLoadError: "Hindi ma-load ang order", orderNotFound: "Hindi nakita ang order", customer: "Customer",
  waitingNextStep: "Naghihintay sa susunod na hakbang", orderDetailsSection: "Detalye ng order", appointment: "Oras ng appointment",
  serviceDuration: "Tagal ng serbisyo", tripType: "Uri ng biyahe", oneWay: "Isang biyahe", roundTrip: "Balikan",
  customerLocation: "Lokasyon ng customer", openLocation: "Buksan ang lokasyon", mapLocation: "Lokasyon sa mapa", orderTeam: "Koponan ng order",
  specialist: "Specialist", driver: "Driver", unassignedFeminine: "Hindi pa nakatalaga", unassignedMasculine: "Hindi pa nakatalaga",
  automaticReminder: "Magpapadala ng awtomatikong paalala kapag walang kilos sa kinakailangang hakbang sa loob ng 30 minuto.",
  driverArrived: "Nasa lokasyon na ako ng specialist", confirmStep: "Kumpirmahin ang hakbang",
  actionFailed: "Hindi na-save ang hakbang. Suriin ang koneksyon at subukan muli.", notifications: "Mga Notification", enabled: "Naka-on",
  disabled: "Naka-off", checkingNotifications: "Sinusuri ang mga notification…", sendTestNotification: "Magpadala ng test notification",
  enableNotifications: "I-enable ang mga notification", notificationRegistered: "Naka-enable ang mga notification sa device na ito.",
  notificationMuted: "Naka-mute ang mga notification sa device na ito.", notificationSimulator: "Hindi gumagana ang notification sa simulator. Gumamit ng totoong device.",
  notificationUnsupported: "Hindi suportado ang notification sa test version na ito.", notificationNoProject: "Hindi kumpleto ang notification setup.",
  notificationDenied: "Naka-block ang mga notification. I-enable ito sa settings ng device at subukan muli.", notificationFailed: "Hindi ma-enable ang mga notification.",
  pushWorksTitle: "Gumagana ang mga notification", pushWorksBody: "Natanggap ng device na ito ang test notification.",
  pushSentTitle: "Naipadala ang test", pushSentBody: "Tinanggap ang notification ngunit wala pang kumpirmasyon ng delivery. Maghintay sandali.",
  pushMissingTitle: "Hindi natanggap ang test", pushNoToken: "Walang notification token ang device na ito. I-enable muna muli ang mga notification.",
  pushRejected: "Tinanggihan ng notification service ang request.", pushTestError: "Hindi ma-test ang mga notification", roleSpecialist: "Specialist",
  roleDriver: "Driver", appLanguage: "Wika ng app", legalSupport: "Legal at suporta", privacy: "Privacy",
  privacyPolicy: "Patakaran sa privacy", openPrivacy: "Buksan ang patakaran sa privacy", terms: "Mga Tuntunin", termsOfUse: "Mga tuntunin sa paggamit ng app",
  openTerms: "Buksan ang mga tuntunin", help: "Tulong", technicalSupport: "Teknikal na suporta", openSupport: "Buksan ang support page",
  logout: "Mag-log out", logoutBody: "Isasara ang session sa device na ito.", unknownError: "Hindi kilalang error",
  todayRelative: "Ngayon", tomorrowRelative: "Bukas", yesterdayRelative: "Kahapon",
  confirmRideTitle: "Kumpirmahin ang pag-alis", confirmRideBody: "Kinukumpirma kong umalis na ako para sunduin ang specialist.",
  driverArrivedTitle: "Dumating sa specialist", driverArrivedBody: "Aabisuhan ang specialist na dumating ka na.",
  confirmPickupTitle: "Nakasakay na ako", confirmPickupBody: "Kinukumpirma kong kasama ko na ang driver at papunta na sa customer.",
  startServiceTitle: "Simulan ang serbisyo", startServiceBody: "Kinukumpirma kong dumating na ako sa bahay ng customer at sinimulan ang serbisyo.",
  completeOrderTitle: "Tapusin ang serbisyo at umalis", completeOrderBody: "Kinukumpirma kong tapos na ang serbisyo at aalis na ako sa bahay ng customer.",
  driverReturnTitle: "Tapusin ang balik na biyahe", driverReturnBody: "Kinukumpirma kong nakabalik na ako at natapos ang biyahe para sa order na ito.",
};

const russian: Dictionary = {
  preparingAccount: "Подготовка аккаунта…", prepareAccountError: "Не удалось подготовить аккаунт", myOrders: "Мои заказы",
  orderDetails: "Детали заказа", account: "Аккаунт", loading: "Загрузка…", retry: "Повторить", cancel: "Назад", confirm: "Подтвердить",
  today: "Сегодня", upcoming: "Предстоящие", previous: "Прошедшие", completedTab: "Завершённые",
  noTodayTitle: "Сегодня заказов нет", noTodayDetail: "Назначенные вам заказы на сегодня появятся здесь.",
  noUpcomingTitle: "Нет предстоящих заказов", noUpcomingDetail: "После сегодняшнего дня поездки не запланированы.",
  noPreviousTitle: "Нет прошлых заказов", noPreviousDetail: "В вашей истории пока нет более ранних заказов.",
  noCompletedTitle: "Нет завершённых заказов", noCompletedDetail: "Заказы появятся здесь после подтверждения возвращения водителя.",
  openOrder: "Открыть заказ: {customer}", completed: "Завершён", waitingForYou: "Ожидает вас", inProgress: "В процессе",
  orderFinished: "Заказ завершён", hello: "Здравствуйте, {name}", ordersGuidance: "Откройте заказ и выполните показанный шаг.",
  filterOrders: "Фильтр моих заказов", loadingOrders: "Загрузка заказов…", ordersLoadError: "Не удалось загрузить заказы",
  stepConfirmRide: "Поездка подтверждена", stepPickup: "Специалист в машине", stepStartService: "Начало услуги",
  stepCompleteService: "Завершение услуги", stepDriverReturn: "Возвращение водителя", managementNotes: "Примечания руководства",
  customerDoor: "Дверь клиента", customerDoorPhoto: "Фото двери клиента", stopListening: "Остановить", listenToNote: "Прослушать заметку",
  managementVoiceNote: "Голосовая заметка от руководства", loadingOrder: "Загрузка заказа…", orderLoadError: "Не удалось загрузить заказ",
  orderNotFound: "Заказ не найден", customer: "Клиент", waitingNextStep: "Ожидание следующего шага", orderDetailsSection: "Детали заказа",
  appointment: "Время визита", serviceDuration: "Длительность услуги", tripType: "Тип поездки", oneWay: "В одну сторону",
  roundTrip: "Туда и обратно", customerLocation: "Адрес клиента", openLocation: "Открыть адрес", mapLocation: "Точка на карте",
  orderTeam: "Команда заказа", specialist: "Специалист", driver: "Водитель", unassignedFeminine: "Не назначена", unassignedMasculine: "Не назначен",
  automaticReminder: "Если нужный шаг не будет выполнен в течение 30 минут, придёт автоматическое напоминание.",
  driverArrived: "Я прибыл к специалисту", confirmStep: "Подтвердить шаг", actionFailed: "Не удалось сохранить шаг. Проверьте соединение и повторите попытку.",
  notifications: "Уведомления", enabled: "Включены", disabled: "Выключены", checkingNotifications: "Проверка уведомлений…",
  sendTestNotification: "Отправить тестовое уведомление", enableNotifications: "Включить уведомления",
  notificationRegistered: "Уведомления включены на этом устройстве.", notificationMuted: "Уведомления отключены на этом устройстве.",
  notificationSimulator: "Уведомления не работают в симуляторе. Используйте настоящее устройство.",
  notificationUnsupported: "Уведомления не поддерживаются в этой тестовой версии.", notificationNoProject: "Настройка уведомлений не завершена.",
  notificationDenied: "Уведомления заблокированы. Включите их в настройках устройства и повторите попытку.", notificationFailed: "Не удалось включить уведомления.",
  pushWorksTitle: "Уведомления работают", pushWorksBody: "Тестовое уведомление доставлено на это устройство.",
  pushSentTitle: "Тест отправлен", pushSentBody: "Сервис принял уведомление, но доставка ещё не подтверждена. Подождите немного.",
  pushMissingTitle: "Тест не доставлен", pushNoToken: "На устройстве нет токена уведомлений. Сначала включите уведомления снова.",
  pushRejected: "Сервис уведомлений отклонил запрос.", pushTestError: "Не удалось проверить уведомления", roleSpecialist: "Специалист",
  roleDriver: "Водитель", appLanguage: "Язык приложения", legalSupport: "Правовая информация и поддержка", privacy: "Конфиденциальность",
  privacyPolicy: "Политика конфиденциальности", openPrivacy: "Открыть политику конфиденциальности", terms: "Условия",
  termsOfUse: "Условия использования приложения", openTerms: "Открыть условия использования", help: "Помощь",
  technicalSupport: "Техническая поддержка", openSupport: "Открыть страницу поддержки", logout: "Выйти",
  logoutBody: "Сеанс на этом устройстве будет завершён.", unknownError: "Неизвестная ошибка", todayRelative: "Сегодня",
  tomorrowRelative: "Завтра", yesterdayRelative: "Вчера", confirmRideTitle: "Подтвердить отправление",
  confirmRideBody: "Подтверждаю, что выехал за специалистом.", driverArrivedTitle: "Я прибыл к специалисту",
  driverArrivedBody: "Специалист получит уведомление о вашем прибытии.", confirmPickupTitle: "Я в машине с водителем",
  confirmPickupBody: "Подтверждаю, что водитель забрал меня и мы едем к клиенту.", startServiceTitle: "Начать услугу",
  startServiceBody: "Подтверждаю, что прибыла к клиенту и начинаю услугу.", completeOrderTitle: "Завершить услугу и уехать",
  completeOrderBody: "Подтверждаю, что услуга завершена и я покидаю дом клиента.", driverReturnTitle: "Завершить обратную поездку",
  driverReturnBody: "Подтверждаю возвращение и завершение поездки по этому заказу.",
};

const amharic: Dictionary = {
  preparingAccount: "መለያዎን በማዘጋጀት ላይ…", prepareAccountError: "መለያውን ማዘጋጀት አልተቻለም",
  myOrders: "የእኔ ትዕዛዞች", orderDetails: "የትዕዛዝ ዝርዝር", account: "መለያ", loading: "በመጫን ላይ…",
  retry: "እንደገና ሞክር", cancel: "ተመለስ", confirm: "አረጋግጥ", today: "ዛሬ", upcoming: "የሚመጡ",
  previous: "ያለፉ", completedTab: "የተጠናቀቁ", noTodayTitle: "ዛሬ ምንም ትዕዛዝ የለም",
  noTodayDetail: "ለእርስዎ የተመደቡ የዛሬ ትዕዛዞች እዚህ ይታያሉ።", noUpcomingTitle: "የሚመጣ ትዕዛዝ የለም",
  noUpcomingDetail: "ከዛሬ በኋላ የታቀደ ጉዞ የለም።", noPreviousTitle: "ያለፈ ትዕዛዝ የለም",
  noPreviousDetail: "በመዝገብዎ ውስጥ የቆየ ትዕዛዝ የለም።", noCompletedTitle: "የተጠናቀቀ ትዕዛዝ የለም",
  noCompletedDetail: "ሹፌሩ የመመለሻ ጉዞውን ካረጋገጠ በኋላ ትዕዛዞች እዚህ ይታያሉ።", openOrder: "የ{customer}ን ትዕዛዝ ክፈት",
  completed: "ተጠናቋል", waitingForYou: "እርስዎን በመጠበቅ ላይ", inProgress: "በሂደት ላይ", orderFinished: "ትዕዛዙ ተጠናቋል",
  hello: "ሰላም {name}", ordersGuidance: "ትዕዛዙን ከፍተው የሚታየውን ደረጃ ብቻ ይከተሉ።", filterOrders: "ትዕዛዞቼን አጣራ",
  loadingOrders: "ትዕዛዞችን በመጫን ላይ…", ordersLoadError: "ትዕዛዞችን መጫን አልተቻለም",
  stepConfirmRide: "ጉዞውን አረጋግጥ", stepPickup: "ባለሙያዋ ተሳፍራለች", stepStartService: "አገልግሎት ጀምር",
  stepCompleteService: "አገልግሎት ጨርስ", stepDriverReturn: "የሹፌሩ መመለስ", managementNotes: "የአስተዳደር ማስታወሻ",
  customerDoor: "የደንበኛዋ በር", customerDoorPhoto: "የደንበኛዋ በር ፎቶ", stopListening: "ማዳመጥ አቁም",
  listenToNote: "ማስታወሻውን አዳምጥ", managementVoiceNote: "ከአስተዳደሩ የድምፅ ማስታወሻ", loadingOrder: "ትዕዛዙን በመጫን ላይ…",
  orderLoadError: "ትዕዛዙን መጫን አልተቻለም", orderNotFound: "ትዕዛዙ አልተገኘም", customer: "ደንበኛ",
  waitingNextStep: "ቀጣዩን ደረጃ በመጠበቅ ላይ", orderDetailsSection: "የትዕዛዝ ዝርዝር", appointment: "የቀጠሮ ሰዓት",
  serviceDuration: "የአገልግሎት ጊዜ", tripType: "የጉዞ አይነት", oneWay: "አንድ መንገድ", roundTrip: "ደርሶ መልስ",
  customerLocation: "የደንበኛዋ አድራሻ", openLocation: "አድራሻውን ክፈት", mapLocation: "የካርታ ቦታ", orderTeam: "የትዕዛዙ ቡድን",
  specialist: "ባለሙያ", driver: "ሹፌር", unassignedFeminine: "አልተመደበችም", unassignedMasculine: "አልተመደበም",
  automaticReminder: "አስፈላጊው ደረጃ ለ30 ደቂቃ ካልተከናወነ ራስ-ሰር ማስታወሻ ይላካል።",
  driverArrived: "ወደ ባለሙያዋ ቦታ ደርሻለሁ", confirmStep: "ደረጃውን አረጋግጥ",
  actionFailed: "ደረጃውን ማስቀመጥ አልተቻለም። ኢንተርኔትዎን ያረጋግጡና እንደገና ይሞክሩ።", notifications: "ማሳወቂያዎች",
  enabled: "ክፍት", disabled: "ዝግ", checkingNotifications: "የማሳወቂያ ሁኔታን በመፈተሽ ላይ…",
  sendTestNotification: "የሙከራ ማሳወቂያ ላክ", enableNotifications: "ማሳወቂያዎችን ክፈት",
  notificationRegistered: "ማሳወቂያዎች በዚህ መሣሪያ ላይ ክፍት ናቸው።", notificationMuted: "ማሳወቂያዎች በዚህ መሣሪያ ላይ ዝግ ናቸው።",
  notificationSimulator: "ማሳወቂያ በሲሙሌተር ላይ አይሰራም። እውነተኛ ስልክ ይጠቀሙ።", notificationUnsupported: "ማሳወቂያ በዚህ የሙከራ ስሪት አይደገፍም።",
  notificationNoProject: "የማሳወቂያ ቅንብሩ አልተሟላም።", notificationDenied: "ማሳወቂያዎች ታግደዋል። በስልክ ቅንብር ውስጥ ይክፈቱና እንደገና ይሞክሩ።",
  notificationFailed: "ማሳወቂያዎችን መክፈት አልተቻለም።", pushWorksTitle: "ማሳወቂያዎች ይሰራሉ",
  pushWorksBody: "የሙከራ ማሳወቂያው ወደዚህ መሣሪያ ደርሷል።", pushSentTitle: "ሙከራው ተልኳል",
  pushSentBody: "ማሳወቂያው ተቀብሏል፣ ግን መድረሱ ገና አልተረጋገጠም። ትንሽ ይጠብቁ።", pushMissingTitle: "ሙከራው አልደረሰም",
  pushNoToken: "ለዚህ መሣሪያ የማሳወቂያ ምልክት የለም። መጀመሪያ ማሳወቂያዎችን እንደገና ያንቁ።",
  pushRejected: "የማሳወቂያ አገልግሎቱ ጥያቄውን አልተቀበለም።", pushTestError: "ማሳወቂያዎችን መሞከር አልተቻለም",
  roleSpecialist: "ባለሙያ", roleDriver: "ሹፌር", appLanguage: "የመተግበሪያ ቋንቋ", legalSupport: "ሕጋዊ መረጃ እና ድጋፍ",
  privacy: "ግላዊነት", privacyPolicy: "የግላዊነት ፖሊሲ", openPrivacy: "የግላዊነት ፖሊሲን ክፈት", terms: "ደንቦች",
  termsOfUse: "የመተግበሪያ አጠቃቀም ደንቦች", openTerms: "የአጠቃቀም ደንቦችን ክፈት", help: "እገዛ",
  technicalSupport: "የቴክኒክ ድጋፍ", openSupport: "የድጋፍ ገጹን ክፈት", logout: "ውጣ",
  logoutBody: "በዚህ መሣሪያ ላይ ያለው ክፍለ ጊዜ ይዘጋል።", unknownError: "ያልታወቀ ስህተት",
  todayRelative: "ዛሬ", tomorrowRelative: "ነገ", yesterdayRelative: "ትናንት",
  confirmRideTitle: "መነሳቱን አረጋግጥ", confirmRideBody: "ባለሙያዋን ለመውሰድ መነሳቴን አረጋግጣለሁ።",
  driverArrivedTitle: "ወደ ባለሙያዋ ደርሻለሁ", driverArrivedBody: "ባለሙያዋ መድረስዎን ትገለጻለች።",
  confirmPickupTitle: "ከሹፌሩ ጋር ተሳፍሬያለሁ", confirmPickupBody: "ከሹፌሩ ጋር ተሳፍሬ ወደ ደንበኛዋ እየሄድኩ መሆኔን አረጋግጣለሁ።",
  startServiceTitle: "አገልግሎት ጀምር", startServiceBody: "ወደ ደንበኛዋ ቤት ደርሼ አገልግሎቱን መጀመሬን አረጋግጣለሁ።",
  completeOrderTitle: "አገልግሎቱን ጨርሰው ይውጡ", completeOrderBody: "አገልግሎቱን ጨርሼ ከደንበኛዋ ቤት መውጣቴን አረጋግጣለሁ።",
  driverReturnTitle: "የመመለሻ ጉዞውን ጨርስ", driverReturnBody: "ተመልሼ የዚህን ትዕዛዝ ጉዞ መጨረሴን አረጋግጣለሁ።",
};

const dictionaries: Record<FieldLocale, Dictionary> = {
  ar: arabic,
  id: indonesian,
  fil: filipino,
  ru: russian,
  am: amharic,
};

const localeTags: Record<FieldLocale, string> = {
  ar: "ar-EG", id: "id-ID", fil: "fil-PH", ru: "ru-RU", am: "am-ET",
};

const languageNames: Record<FieldLocale, string> = {
  ar: "العربية", id: "Bahasa Indonesia", fil: "Filipino", ru: "Русский", am: "አማርኛ",
};

const nationalityLocales: Record<string, FieldLocale> = {
  sa: "ar", eg: "ar", ma: "ar", tn: "ar", sy: "ar", id: "id", ph: "fil", ru: "ru", et: "am",
};

export function fieldLocaleForSession(
  role: string | null | undefined,
  nationality: string | null | undefined,
  preferredLanguage: string | null | undefined,
): FieldLocale {
  if (role !== "specialist") return "ar";
  if (preferredLanguage && FIELD_LOCALES.includes(preferredLanguage as FieldLocale)) {
    return preferredLanguage as FieldLocale;
  }
  return nationalityLocales[nationality ?? ""] ?? "ar";
}

function interpolate(value: string, variables?: Record<string, string | number>): string {
  if (!variables) return value;
  return value.replace(/\{(\w+)\}/g, (_, key: string) => String(variables[key] ?? `{${key}}`));
}

const confirmationKeys: Record<FieldOrderAction, [TranslationKey, TranslationKey]> = {
  confirm_ride: ["confirmRideTitle", "confirmRideBody"],
  driver_arrived: ["driverArrivedTitle", "driverArrivedBody"],
  confirm_pickup: ["confirmPickupTitle", "confirmPickupBody"],
  start_service: ["startServiceTitle", "startServiceBody"],
  complete_order: ["completeOrderTitle", "completeOrderBody"],
  driver_return: ["driverReturnTitle", "driverReturnBody"],
};

const actionLabelKeys: Record<FieldOrderAction, TranslationKey> = {
  confirm_ride: "confirmRideTitle",
  driver_arrived: "driverArrived",
  confirm_pickup: "confirmPickupTitle",
  start_service: "startServiceTitle",
  complete_order: "completeOrderTitle",
  driver_return: "driverReturnTitle",
};

type FieldI18n = {
  locale: FieldLocale;
  localeTag: string;
  languageName: string;
  isRtl: boolean;
  rowDirection: FlexStyle["flexDirection"];
  textStyle: TextStyle;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
  formatTime: (iso: string) => string;
  relativeDay: (iso: string, now?: Date) => string;
  duration: (minutes: number) => string;
  tripType: (trip: TripType) => string;
  actionLabel: (action: FieldOrderAction) => string;
  confirmation: (action: FieldOrderAction) => { title: string; body: string };
};

function createI18n(locale: FieldLocale): FieldI18n {
  const dictionary = dictionaries[locale];
  const localeTag = localeTags[locale];
  const isRtl = locale === "ar";
  const t: FieldI18n["t"] = (key, variables) => interpolate(dictionary[key], variables);
  const number = new Intl.NumberFormat(localeTag);
  const date = new Intl.DateTimeFormat(localeTag, { weekday: "long", day: "numeric", month: "long" });
  const time = new Intl.DateTimeFormat(localeTag, { hour: "numeric", minute: "2-digit" });

  return {
    locale,
    localeTag,
    languageName: languageNames[locale],
    isRtl,
    rowDirection: isRtl ? "row-reverse" : "row",
    textStyle: { textAlign: isRtl ? "right" : "left", writingDirection: isRtl ? "rtl" : "ltr" },
    t,
    formatTime: (iso) => time.format(new Date(iso)),
    relativeDay: (iso, now = new Date()) => {
      const target = new Date(iso);
      const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
      const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const offset = Math.round((targetDay - nowDay) / 86_400_000);
      if (offset === 0) return t("todayRelative");
      if (offset === 1) return t("tomorrowRelative");
      if (offset === -1) return t("yesterdayRelative");
      return date.format(target);
    },
    duration: (minutes) => {
      const formattedMinutes = number.format(minutes);
      if (minutes < 60) {
        if (locale === "ar") return `${formattedMinutes} دقيقة`;
        if (locale === "id") return `${formattedMinutes} menit`;
        if (locale === "fil") return `${formattedMinutes} minuto`;
        if (locale === "ru") return `${formattedMinutes} мин`;
        return `${formattedMinutes} ደቂቃ`;
      }
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      const formattedHours = number.format(hours);
      const formattedRest = number.format(rest);
      if (locale === "ar") {
        const hoursLabel = hours === 1 ? "ساعة" : hours === 2 ? "ساعتان" : `${formattedHours} ساعات`;
        return rest ? `${hoursLabel} و${formattedRest} د` : hoursLabel;
      }
      const units: [string, string] = locale === "id"
        ? [`${formattedHours} jam`, `${formattedRest} menit`]
        : locale === "fil"
          ? [`${formattedHours} oras`, `${formattedRest} minuto`]
          : locale === "ru"
            ? [`${formattedHours} ч`, `${formattedRest} мин`]
            : [`${formattedHours} ሰዓት`, `${formattedRest} ደቂቃ`];
      return rest ? `${units[0]} ${units[1]}` : units[0];
    },
    tripType: (trip) => t(trip === "round_trip" ? "roundTrip" : "oneWay"),
    actionLabel: (action) => t(actionLabelKeys[action]),
    confirmation: (action) => {
      const [title, body] = confirmationKeys[action];
      return { title: t(title), body: t(body) };
    },
  };
}

const defaultValue = createI18n("ar");
const FieldI18nContext = createContext<FieldI18n>(defaultValue);

export function FieldI18nProvider({ locale, children }: PropsWithChildren<{ locale: FieldLocale }>) {
  const value = useMemo(() => createI18n(locale), [locale]);
  return <FieldI18nContext value={value}>{children}</FieldI18nContext>;
}

export function useFieldI18n(): FieldI18n {
  return use(FieldI18nContext);
}
