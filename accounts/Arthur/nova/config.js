let prefix = '.';

//بيانات افتراضية
const config = {
    botName: 'Anastasia',
    version: '4.0.0',
    owner: '213779502739',

    defaultPrefix: '.',

    pairing:{
        phone: "213773231685",
        code : "ART1ART1",
    },

    // ── Stellarwa API — يوتيوب وغيرها ──
    api: {
        url: 'https://api.stellarwa.xyz',
        key: 'api-JP9nq',
    },

    botState:{
        bot: "on",
        mode: "on",
        nova: "on",
    },


    novaInfo: {
    ceiling: "𝙰𝚁𝚃 ©",
    name: "𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝",
    description: "𝚄𝙻𝚃𝚁𝙰 𝙽𝙾𝚅𝙰",
    verification: true,
    media: true
},

    get prefix() {
        return prefix;
    },

    set prefix(newPrefix) {
        if (newPrefix && typeof newPrefix === 'string') {
            prefix = newPrefix;
        }
    },

    allowedGroups: [],

    messages: {
        error: '❌ حدث خطأ أثناء تنفيذ الأمر',
        noPermission: 'ليس لديك صلاحية لاستخدام هذا الأمر',
        groupOnly: 'هذا الأمر متاح فقط في المجموعات',
        ownerOnly: 'هذا الأمر متاح فقط للنخبة',
        notAllowedGroup: 'عذراً، البوت لا يعمل في هذه المجموعة'
    },

    colors: {
        success: '\x1b[38;2;255;255;0m',
        error:   '\x1b[38;2;255;80;120m',
        info:    '\x1b[38;2;140;120;255m',
        warn:    '\x1b[38;2;255;200;0m',
        reset:   '\x1b[0m'
    },
};

export default config;
