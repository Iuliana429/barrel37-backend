const express = require('express');
const { ApolloServer, gql } = require('apollo-server-express');
const cors = require('cors');
const { Sequelize, DataTypes } = require('sequelize');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
app.use(cors());

// --- DB SETUP ---
let sequelize;

if (process.env.NODE_ENV === 'test') {
    sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: ':memory:',
        logging: false
    });
} else {
    sequelize = new Sequelize(process.env.DATABASE_URL || "postgres://avnadmin:AVNS_tzD2DWTzG47jcFlU1-R@pg-3ce41d0e-ioniuliana05-5798.j.aivencloud.com:22591/defaultdb?ssl=true&sslmode=no-verify", {
        dialect: 'postgres',
        protocol: 'postgres',
        dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
        logging: false
    });
}

// --- MODELS (Strictly Relational & 3NF) ---
const Category = sequelize.define('Category', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false, unique: true }
});

const Item = sequelize.define('Item', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    price: { type: DataTypes.FLOAT, allowNull: false },
    desc: { type: DataTypes.STRING },
    categoryId: { type: DataTypes.INTEGER, allowNull: false }
});

const Role = sequelize.define('Role', { name: { type: DataTypes.STRING, allowNull: false, unique: true } });
const Permission = sequelize.define('Permission', { action: { type: DataTypes.STRING, allowNull: false, unique: true } });
const User = sequelize.define('User', { username: { type: DataTypes.STRING, allowNull: false, unique: true } });

// --- GOLD CHALLENGE: LOGGING & SURVEILLANCE MODELS ---
const SystemLog = sequelize.define('SystemLog', {
    username: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, allowNull: false },
    action: { type: DataTypes.STRING, allowNull: false }
});

const ObservationList = sequelize.define('ObservationList', {
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    reason: { type: DataTypes.STRING, allowNull: false }
});

// --- NoSQL CHAT SCHEMA (MongoDB) ---
const chatSchema = new mongoose.Schema({
    user: String, text: String, time: { type: Date, default: Date.now }
});
const ChatMessage = mongoose.model('ChatMessage', chatSchema);

// --- RELATIONSHIPS ---
Category.hasMany(Item, { foreignKey: 'categoryId', onDelete: 'CASCADE' });
Item.belongsTo(Category, { foreignKey: 'categoryId' });
Role.hasMany(User, { foreignKey: 'roleId' });
User.belongsTo(Role, { foreignKey: 'roleId' });
Role.belongsToMany(Permission, { through: 'RolePermissions' });
Permission.belongsToMany(Role, { through: 'RolePermissions' });

let generatorInterval = null;

// --- GRAPHQL SCHEMA ---
const typeDefs = gql`
  type Category { id: ID!  name: String!  items: [Item] }
  type Item     { id: ID!  name: String!  price: Float!  desc: String  category: Category }
  type InventoryPage { data: [Item]  totalCount: Int  hasNextPage: Boolean }
  type Stats    { totalItems: Int  averagePrice: Float }

  type Role { id: ID! name: String! }
  type User { id: ID! username: String! role: Role }

  type SystemLog { id: ID! username: String! role: String! action: String! createdAt: String }
  type FlaggedUser { id: ID! username: String! reason: String! createdAt: String }

  type Query {
    items(page: Int, limit: Int): InventoryPage
    categories: [Category]
    statistics: Stats
    getLogs: [SystemLog]
    getFlaggedUsers: [FlaggedUser]
    # --- AUTHENTICATION QUERY ---
    login(username: String!): User
  }
  
  type Mutation {
    addItem(name: String!, price: Float!, categoryId: ID!, desc: String, username: String!, role: String!): Item
    updateItem(id: ID!, name: String!, price: Float!, categoryId: ID!, desc: String, username: String!, role: String!): Item
    deleteItem(id: ID!, username: String!, role: String!): ID
    toggleGenerator(action: String!): String
    # --- REGISTRATION MUTATION ---
    register(username: String!): User
  }
`;

// --- GOLD CHALLENGE: STEALTH LOGIC HELPERS ---
const logAction = async (username, role, action) => {
    await SystemLog.create({ username, role, action });
};

const flagHacker = async (username, reason) => {
    await ObservationList.findOrCreate({ where: { username }, defaults: { reason } });
};

// --- RESOLVERS ---
const resolvers = {
    User: { role: async (parent) => Role.findByPk(parent.roleId) },
    Query: {
        items: async (_, { page = 1, limit = 6 }) => {
            const offset = (page - 1) * limit;
            const { count, rows } = await Item.findAndCountAll({ include: Category, limit, offset, order: [['createdAt', 'DESC']] });
            return { data: rows, totalCount: count, hasNextPage: offset + limit < count };
        },
        categories: async () => Category.findAll(),
        statistics: async () => {
            const totalItems = await Item.count();
            const avg = await Item.findOne({ attributes: [[sequelize.fn('AVG', sequelize.col('price')), 'avg']] });
            return { totalItems, averagePrice: parseFloat(avg?.dataValues?.avg || 0) };
        },
        getLogs: async () => await SystemLog.findAll({ order: [['createdAt', 'DESC']] }),
        getFlaggedUsers: async () => await ObservationList.findAll({ order: [['createdAt', 'DESC']] }),

        // --- AUTHENTICATION RESOLVER ---
        login: async (_, { username }) => {
            const user = await User.findOne({ where: { username } });
            if (!user) throw new Error("User not found. Please create an account.");
            return user;
        }
    },
    Item: { category: async (parent) => parent.Category || Category.findByPk(parent.categoryId) },
    Category: { items: async (parent) => Item.findAll({ where: { categoryId: parent.id } }) },

    Mutation: {
        // --- REGISTRATION RESOLVER ---
        register: async (_, { username }) => {
            if (!username || username.trim() === '') throw new Error("Username cannot be empty.");
            const existing = await User.findOne({ where: { username } });
            if (existing) throw new Error("Username is already taken!");

            const normalRole = await Role.findOne({ where: { name: 'normal user' } });
            const user = await User.create({ username, roleId: normalRole.id });
            await logAction(username, 'normal user', `New user registered account`);
            return user;
        },

        addItem: async (_, { name, price, categoryId, desc, username, role }) => {
            if (role !== 'admin') {
                await logAction(username, role, `ILLEGAL ATTEMPT: Tried to add item ${name}`);
                await flagHacker(username, 'Attempted to add inventory without admin privileges');
                throw new Error("Unauthorized action flagged.");
            }
            const item = await Item.create({ name, price, categoryId: parseInt(categoryId), desc });
            await logAction(username, role, `Added new item: ${name}`);
            return Item.findByPk(item.id, { include: Category });
        },
        updateItem: async (_, { id, name, price, categoryId, desc, username, role }) => {
            if (role !== 'admin') {
                await logAction(username, role, `ILLEGAL ATTEMPT: Tried to edit item ID ${id}`);
                await flagHacker(username, 'Attempted to edit inventory without admin privileges');
                throw new Error("Unauthorized action flagged.");
            }
            await Item.update({ name, price, categoryId: parseInt(categoryId), desc }, { where: { id } });
            await logAction(username, role, `Updated item: ${name}`);
            return Item.findByPk(id, { include: Category });
        },
        deleteItem: async (_, { id, username, role }) => {
            if (role !== 'admin') {
                await logAction(username, role, `ILLEGAL ATTEMPT: Tried to delete item ID ${id}`);
                await flagHacker(username, 'Attempted to delete inventory without admin privileges');
                throw new Error("Unauthorized action flagged.");
            }
            const item = await Item.findByPk(id);
            await Item.destroy({ where: { id } });
            await logAction(username, role, `Deleted item: ${item?.name || id}`);
            return id;
        },
        toggleGenerator: (_, { action }) => {
            const drinkNames = {
                1: ["Negroni", "Manhattan", "Whiskey Sour", "Mojito", "Espresso Martini"],
                2: ["Double Apple", "Minty Grape", "Blueberry Ice", "Watermelon Chill"],
                3: ["Chardonnay", "Cabernet Sauvignon", "Pinot Noir", "Merlot"]
            };
            if (action === 'start' && !generatorInterval) {
                generatorInterval = setInterval(async () => {
                    const catId = Math.floor(Math.random() * 3) + 1;
                    const names = drinkNames[catId];
                    await Item.create({ name: names[Math.floor(Math.random() * names.length)], price: Math.floor(Math.random() * 80) + 30, categoryId: catId, desc: "Chef's Special" });
                }, 3000);
                return "Started";
            } else if (action === 'stop') {
                clearInterval(generatorInterval);
                generatorInterval = null;
                return "Stopped";
            }
            return "No action taken";
        }
    }
};

// --- SERVER INITIALIZATION ---
async function startServer() {
    await sequelize.sync({ force: false });
    await Category.findOrCreate({ where: { id: 1 }, defaults: { name: 'Cocktail' } });
    await Category.findOrCreate({ where: { id: 2 }, defaults: { name: 'Shisha' } });
    await Category.findOrCreate({ where: { id: 3 }, defaults: { name: 'Wine' } });

    const [adminRole] = await Role.findOrCreate({ where: { name: 'admin' } });
    const [normalRole] = await Role.findOrCreate({ where: { name: 'normal user' } });
    await User.findOrCreate({ where: { username: 'Admin_Boss' }, defaults: { roleId: adminRole.id } });
    await User.findOrCreate({ where: { username: 'Standard_Steve' }, defaults: { roleId: normalRole.id } });

    const apolloServer = new ApolloServer({ typeDefs, resolvers, introspection: true });
    await apolloServer.start();
    apolloServer.applyMiddleware({ app });
    app.get('/api/items', (req, res) => res.json({ ok: true }));

    const MONGO_URI = "mongodb+srv://izzy:Memeliciu%4033@cluster0.e5wdwfb.mongodb.net/chatDB?retryWrites=true&w=majority";
    if (process.env.NODE_ENV !== 'test') {
        try {
            await mongoose.connect(MONGO_URI);
            console.log("🍃 Connected to MongoDB for Chat!");
        } catch (err) { console.error("MongoDB connection error:", err); }
    }

    const httpServer = http.createServer(app);
    const io = new Server(httpServer, { cors: { origin: "*", methods: ["GET", "POST"] } });

    io.on("connection", async (socket) => {
        if (process.env.NODE_ENV !== 'test') {
            const messages = await ChatMessage.find().sort({ time: 1 }).limit(50);
            socket.emit("previousMessages", messages);
        }
        socket.on("sendMessage", async (data) => {
            if (process.env.NODE_ENV !== 'test') {
                const newMsg = new ChatMessage({ user: data.user, text: data.text });
                await newMsg.save();
                io.emit("newMessage", newMsg);
            }
        });
    });

    if (process.env.NODE_ENV !== 'test') {
        const PORT = process.env.PORT || 5000;
        httpServer.listen(PORT, '0.0.0.0', () => { console.log(`🚀 Fullstack Server ready on port ${PORT}`); });
    }
}

if (process.env.NODE_ENV !== 'test') startServer();
else {
    async function initTestMiddleware() {
        await sequelize.sync({ force: false });
        const server = new ApolloServer({ typeDefs, resolvers, introspection: true });
        await server.start();
        server.applyMiddleware({ app });
        app.get('/api/items', (req, res) => res.json({ ok: true }));
    }
    initTestMiddleware();
}
module.exports = { app, sequelize, Category, Item, User, Role, Permission, SystemLog, ObservationList };