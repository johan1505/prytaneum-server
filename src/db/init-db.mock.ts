import { ObjectID, ObjectId } from 'mongodb';
import bcrypt from 'bcrypt';
import makeDebug from 'debug';
import {
    makeUser,
    User,
    makeTownhalls,
    Townhall,
    makeTownhallState,
    Question,
    makeQuestion,
} from 'prytaneum-typings';

import 'config/env';
import { SALT_ROUNDS } from 'modules/user';
import { useCollection, connect } from './mongo';

const info = makeDebug('prytaneum:init');

const args = process.argv.slice(2);
const [adminPass] = args;
if (!adminPass) throw new Error('Please pass an admin password as an argument');

const userId = new ObjectId();
// init user
const user: User<ObjectId> = {
    ...makeUser(),
    _id: userId,
    meta: {
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
    },
    email: {
        address: 'admin@prytaneum.io',
        verified: true,
    },
    roles: ['admin', 'organizer'],
    password: bcrypt.hashSync(adminPass, SALT_ROUNDS),
};

const makeQuestions = (
    townhallId: ObjectId,
    num?: number
): Question<ObjectId>[] => {
    const iterations = num || 30;
    const questions: Question<ObjectId>[] = [];
    for (let i = 0; i < iterations; i += 1) {
        const tempQ = makeQuestion();
        questions.push({
            ...tempQ,
            _id: new ObjectID(),
            meta: {
                ...tempQ.meta,
                townhallId,
                createdBy: {
                    _id: user._id,
                    name: user.name,
                },
                updatedBy: {
                    _id: user._id,
                    name: user.name,
                },
            },
        });
    }
    return questions;
};

async function insertQuestions(questions: Question<ObjectId>[]) {
    await useCollection('Questions', (Questions) =>
        Questions.insertMany(questions, { forceServerObjectId: true })
    );
}

const makeTownhallsWithQuestions = async (
    num?: number
): Promise<Townhall<ObjectId>[]> => {
    const allQuestions: Question<ObjectId>[] = [];
    const townhalls: Townhall<ObjectId>[] = makeTownhalls(num || 20).map(
        (townhall) => {
            const townhallId = new ObjectId();
            const list = makeQuestions(townhallId, 30);
            allQuestions.push(...list);
            const [playing] = list;
            const queued = list.slice(15, 20);
            const played = list.slice(8, 10);
            return {
                ...townhall,
                _id: townhallId,
                meta: {
                    ...townhall.meta,
                    createdBy: {
                        _id: user._id,
                        name: user.name,
                    },
                    updatedBy: {
                        _id: user._id,
                        name: user.name,
                    },
                },
                state: {
                    ...makeTownhallState(),
                    playing,
                    playlist: {
                        queued,
                        list,
                        played,
                    },
                },
            };
        }
    );
    await insertQuestions(allQuestions);
    return townhalls;
};

async function insertTownhalls(townhalls: Townhall<ObjectId>[]) {
    await useCollection('Townhalls', (Townhalls) =>
        Townhalls.insertMany(townhalls, { forceServerObjectId: true })
    );
}
async function insertUser() {
    await useCollection('Users', (Users) => Users.insertOne(user));
}

async function isInitialized() {
    const found = await useCollection('Users', (Users) =>
        Users.findOne({ 'email.address': 'admin@prytaneum.io' })
    );
    return Boolean(found);
}

async function init() {
    info('Connecting to db...');
    await connect();

    if (await isInitialized()) {
        info('Database is already initialized');
        return;
    }
    info('Generating & inserting data...');
    await insertUser();
    // questions are also inserted when townhalls are made
    const townhalls = await makeTownhallsWithQuestions(15);
    await insertTownhalls(townhalls);
    info('Finished inserting all data');
}

init()
    .catch((e) => {
        info(e);
        process.exit(1);
    })
    .finally(() => {
        info('Finished initialization');
        process.exit(0);
    });
