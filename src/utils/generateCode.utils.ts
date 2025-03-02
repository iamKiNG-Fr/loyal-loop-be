import {nanoid} from 'nanoid'

export function generateCode(num: number){
    return nanoid(num).toUpperCase();
}