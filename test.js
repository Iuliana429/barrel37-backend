const request = require('supertest');
const { app, sequelize } = require('./serverDB');

beforeAll(async () => {
    // Wait for SQLite memory DB to sync before tests run
    await sequelize.sync({ force: true });
    // Create an initial category so foreign keys don't fail
    const { Category } = require('./serverDB');
    await Category.create({ id: 1, name: 'Cocktail' });
});

afterAll(async () => {
    await sequelize.close();
});

const query = async (q) => {
    return await request(app).post('/graphql').send(q);
};

test('GET /api/items returns ok', async () => {
    const res = await request(app).get('/api/items');
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
});

test('GraphQL: fetch items', async () => {
    const res = await query({ query: `query { items { totalCount } }` });
    expect(res.body.data.items).toBeDefined();
});

test('GraphQL: add item', async () => {
    const res = await query({
        query: `mutation { addItem(name: "Test Drink", price: 55, categoryId: "1", username: "Admin_Boss", role: "admin") { id name } }`
    });
    expect(res.body.data.addItem.name).toBe('Test Drink');
});

test('GraphQL: update item', async () => {
    // First add an item as admin
    const add = await query({
        query: `mutation { addItem(name: "Before", price: 10, categoryId: "1", username: "Admin_Boss", role: "admin") { id } }`
    });
    const id = add.body.data.addItem.id;

    // Then update it as admin
    const res = await query({
        query: `mutation { updateItem(id: "${id}", name: "After", price: 20, categoryId: "1", username: "Admin_Boss", role: "admin") { name } }`
    });
    expect(res.body.data.updateItem.name).toBe('After');
});

test('GraphQL: delete item', async () => {
    // First add an item as admin
    const add = await query({
        query: `mutation { addItem(name: "ToDelete", price: 10, categoryId: "1", username: "Admin_Boss", role: "admin") { id } }`
    });
    const id = add.body.data.addItem.id;

    // Then delete it as admin
    const del = await query({
        query: `mutation { deleteItem(id: "${id}", username: "Admin_Boss", role: "admin") }`
    });
    expect(del.body.data.deleteItem).toBe(id);
});

test('GraphQL: statistics', async () => {
    const res = await query({ query: `query { statistics { totalItems } }` });
    expect(res.body.data.statistics.totalItems).toBeDefined();
});