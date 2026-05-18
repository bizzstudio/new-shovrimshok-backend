// utils/gen6.js
// יצירת קוד 6 ספרות אקראי
const gen6 = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

module.exports = gen6;