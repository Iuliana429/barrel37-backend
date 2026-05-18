'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.bulkInsert('Categories', [
            { name: 'Cocktail', createdAt: new Date(), updatedAt: new Date() },
            { name: 'Shisha', createdAt: new Date(), updatedAt: new Date() },
            { name: 'Wine', createdAt: new Date(), updatedAt: new Date() },
        ]);

        await queryInterface.bulkInsert('Items', [
            { name: 'Old Fashioned', price: 72, categoryId: 1, desc: 'Classic', createdAt: new Date(), updatedAt: new Date() },
            { name: 'Premium Shisha', price: 500, categoryId: 2, desc: 'Top shelf', createdAt: new Date(), updatedAt: new Date() },
            { name: 'Red Wine Reserve', price: 120, categoryId: 3, desc: 'Aged oak', createdAt: new Date(), updatedAt: new Date() },
        ]);
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.bulkDelete('Items', null, {});
        await queryInterface.bulkDelete('Categories', null, {});
    }
};