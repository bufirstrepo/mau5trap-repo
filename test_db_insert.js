const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: 'test.sqlite'
});

const User = sequelize.define('User', {
    email: { type: DataTypes.STRING, unique: true, allowNull: false },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: 'viewer' },
    artistAccess: { type: DataTypes.STRING, defaultValue: 'none' },
    pageAccess: { type: DataTypes.TEXT, defaultValue: '["overview"]' },
    resetToken: { type: DataTypes.STRING },
    resetTokenExpiry: { type: DataTypes.DATE }
});

(async () => {
    try {
        await sequelize.sync({ force: true });
        console.log('Sync complete');

        await User.create({
            email: 'test@test.com',
            passwordHash: 'hash',
            name: 'Test',
            role: 'viewer',
            artistAccess: 'none',
            pageAccess: '["overview"]'
        });
        console.log('User created!');
    } catch (e) {
        console.error('Error:', e);
    }
})();
