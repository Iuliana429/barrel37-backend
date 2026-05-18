const request = require('supertest');
const { app, sequelize, Category, Item } = require('./serverDB');

beforeAll(async () => {
    await sequelize.sync({ force: true });
    const cat = await Category.create({ name: 'Cocktail' });
    await Item.create({ name: 'Negroni', price: 60, categoryId: cat.id, desc: 'Test' });
});

afterAll(async () => {
    await sequelize.close();
});

const query = (body) =>
    request(app).post('/graphql').send(body).set('Content-Type', 'application/json');

test('GET /api/items returns ok', async () => {
    const res = await request(app).get('/api/items');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
});

test('GraphQL: fetch items', async () => {
    const res = await query({ query: '{ items { data { id name price } totalCount } }' });
    expect(res.status).toBe(200);
    expect(res.body.data.items.totalCount).toBeGreaterThan(0);
});

test('GraphQL: add item', async () => {
    const res = await query({
        query: `mutation { addItem(name: "Test Drink", price: 55, categoryId: "1") { id name } }`
    });
    expect(res.body.data.addItem.name).toBe('Test Drink');
});

test('GraphQL: update item', async () => {
    const add = await query({
        query: `mutation { addItem(name: "Before", price: 10, categoryId: "1") { id } }`
    });
    const id = add.body.data.addItem.id;
    const res = await query({
        query: `mutation { updateItem(id: "${id}", name: "After", price: 20, categoryId: "1") { name } }`
    });
    expect(res.body.data.updateItem.name).toBe('After');
});

test('GraphQL: delete item', async () => {
    const add = await query({
        query: `mutation { addItem(name: "ToDelete", price: 10, categoryId: "1") { id } }`
    });
    const id = add.body.data.addItem.id;
    const del = await query({ query: `mutation { deleteItem(id: "${id}") }` });
    expect(del.body.data.deleteItem).toBe(id);
});

test('GraphQL: statistics', async () => {
    const res = await query({ query: '{ statistics { totalItems averagePrice } }' });
    expect(res.body.data.statistics.totalItems).toBeGreaterThan(0);
    expect(res.body.data.statistics.averagePrice).toBeGreaterThan(0);
});