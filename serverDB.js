const express = require('express');
const { ApolloServer, gql } = require('apollo-server-express');
const cors = require('cors');
const { Sequelize, DataTypes } = require('sequelize');
// --- NEW TOOLS FOR SILVER CHALLENGE ---
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
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false
            }
        },
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

// --- USER & ROLE MODELS (Silver Challenge) ---
const Role = sequelize.define('Role', {
    name: { type: DataTypes.STRING, allowNull: false, unique: true }
});

const Permission = sequelize.define('Permission', {
    action: { type: DataTypes.STRING, allowNull: false, unique: true }
});

const User = sequelize.define('User', {
    username: { type: DataTypes.STRING, allowNull: false, unique: true }
});

// --- NoSQL CHAT SCHEMA (MongoDB) ---
const chatSchema = new mongoose.Schema({
    user: String,
    text: String,
    time: { type: Date, default: Date.now }
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

  type Query {
    items(page: Int, limit: Int): InventoryPage
    categories: [Category]
    statistics: Stats
  }
  type Mutation {
    addItem(name: String!, price: Float!, categoryId: ID!, desc: String): Item
    updateItem(id: ID!, name: String!, price: Float!, categoryId: ID!, desc: String): Item
    deleteItem(id: ID!): ID
    toggleGenerator(action: String!): String
  }
`;

// --- RESOLVERS ---
const resolvers = {
    Query: {
        items: async (_, { page = 1, limit = 6 }) => {
            const offset = (page - 1) * limit;
            const { count, rows } = await Item.findAndCountAll({
                include: Category,
                limit,
                offset,
                order: [['createdAt', 'DESC']]
            });
            return { data: rows, totalCount: count, hasNextPage: offset + limit < count };
        },
        categories: async () => Category.findAll(),
        statistics: async () => {
            const totalItems = await Item.count();
            const avg = await Item.findOne({
                attributes: [[sequelize.fn('AVG', sequelize.col('price')), 'avg']]
            });
            return { totalItems, averagePrice: parseFloat(avg?.dataValues?.avg || 0) };
        }
    },

    Item: {
        category: async (parent) => parent.Category || Category.findByPk(parent.categoryId)
    },
    Category: {
        items: async (parent) => Item.findAll({ where: { categoryId: parent.id } })
    },

    Mutation: {
        addItem: async (_, { name, price, categoryId, desc }) => {
            const item = await Item.create({ name, price, categoryId: parseInt(categoryId), desc });
            return Item.findByPk(item.id, { include: Category });
        },
        updateItem: async (_, { id, name, price, categoryId, desc }) => {
            await Item.update({ name, price, categoryId: parseInt(categoryId), desc }, { where: { id } });
            return Item.findByPk(id, { include: Category });
        },
        deleteItem: async (_, { id }) => {
            await Item.destroy({ where: { id } });
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
                    await Item.create({
                        name: names[Math.floor(Math.random() * names.length)],
                        price: Math.floor(Math.random() * 80) + 30,
                        categoryId: catId,
                        desc: "Chef's Special"
                    });
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
    // 1. Connect to Postgres (Aiven)
    await sequelize.sync({ force: false });
    await Category.findOrCreate({ where: { id: 1 }, defaults: { name: 'Cocktail' } });
    await Category.findOrCreate({ where: { id: 2 }, defaults: { name: 'Shisha' } });
    await Category.findOrCreate({ where: { id: 3 }, defaults: { name: 'Wine' } });

    const [adminRole] = await Role.findOrCreate({ where: { name: 'admin' } });
    const [normalRole] = await Role.findOrCreate({ where: { name: 'normal user' } });
    await User.findOrCreate({ where: { username: 'Admin_Boss' }, defaults: { roleId: adminRole.id } });
    await User.findOrCreate({ where: { username: 'Standard_Steve' }, defaults: { roleId: normalRole.id } });

    // 2. Start Apollo GraphQL
    const apolloServer = new ApolloServer({ typeDefs, resolvers, introspection: true });
    await apolloServer.start();
    apolloServer.applyMiddleware({ app });
    app.get('/api/items', (req, res) => res.json({ ok: true }));

    // 3. Connect to NoSQL (MongoDB)
    const MONGO_URI = "mongodb+srv://izzy:Memeliciu%4033@cluster0.e5wdwfb.mongodb.net/chatDB?retryWrites=true&w=majority";

    if (process.env.NODE_ENV !== 'test') {
        try {
            await mongoose.connect(MONGO_URI);
            console.log("🍃 Connected to MongoDB for Chat!");
        } catch (err) {
            console.error("MongoDB connection error:", err);
        }
    }

    // 4. Setup WebSockets (Socket.io)
    const httpServer = http.createServer(app);
    const io = new Server(httpServer, {
        cors: { origin: "*", methods: ["GET", "POST"] }
    });

    io.on("connection", async (socket) => {
        console.log("A user connected to the chat!");

        // When someone joins, send them the last 50 messages from the database
        if (process.env.NODE_ENV !== 'test') {
            const messages = await ChatMessage.find().sort({ time: 1 }).limit(50);
            socket.emit("previousMessages", messages);
        }

        // When someone sends a message, save it to Mongo and broadcast it to everyone
        socket.on("sendMessage", async (data) => {
            if (process.env.NODE_ENV !== 'test') {
                const newMsg = new ChatMessage({ user: data.user, text: data.text });
                await newMsg.save();
                io.emit("newMessage", newMsg);
            }
        });

        socket.on("disconnect", () => console.log("User disconnected"));
    });

    // 5. Start Listening! (Notice we use httpServer now, not app)
    if (process.env.NODE_ENV !== 'test') {
        const PORT = process.env.PORT || 5000;
        httpServer.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Fullstack Server ready on port ${PORT}`);
        });
    }
}

// --- SAFE SERVER INVOCATION ---
if (process.env.NODE_ENV !== 'test') {
    startServer();
} else {
    async function initTestMiddleware() {
        await sequelize.sync({ force: false });
        const server = new ApolloServer({ typeDefs, resolvers, introspection: true });
        await server.start();
        server.applyMiddleware({ app });
        app.get('/api/items', (req, res) => res.json({ ok: true }));
    }
    initTestMiddleware();
}

module.exports = { app, sequelize, Category, Item, User, Role, Permission };