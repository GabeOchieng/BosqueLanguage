"use strict";
//-------------------------------------------------------------------------------------------------------
// Copyright (C) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE.txt file in the project root for full license information.
//-------------------------------------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
const mir_assembly_1 = require("../../compiler/mir_assembly");
const mir_ops_1 = require("../../compiler/mir_ops");
const mir_info_1 = require("../../compiler/mir_info");
const assert = require("assert");
function NOT_IMPLEMENTED(msg) {
    throw new Error(`Not Implemented: ${msg}`);
}
function filenameClean(file) {
    return file.replace(/[\\]/g, "/");
}
class CPPBodyEmitter {
    constructor(assembly, typegen) {
        this.allPropertyNames = new Set();
        this.allConstStrings = new Map();
        this.allConstBigInts = new Map();
        this.currentFile = "[No File]";
        this.vtypes = new Map();
        this.generatedBlocks = new Map();
        this.subtypeOrderCtr = 0;
        this.subtypeFMap = new Map();
        this.vfieldUpdates = [];
        this.vobjmerges = [];
        this.assembly = assembly;
        this.typegen = typegen;
        this.currentRType = typegen.noneType;
    }
    labelToCpp(label) {
        return label;
    }
    varNameToCppName(name) {
        if (name === "this") {
            return this.typegen.mangleStringForCpp("$this");
        }
        else if (name === "$$return") {
            return "$$return";
        }
        else {
            return this.typegen.mangleStringForCpp(name);
        }
    }
    varToCppName(varg) {
        return this.varNameToCppName(varg.nameID);
    }
    invokenameToCPP(ivk) {
        return this.typegen.mangleStringForCpp(ivk);
    }
    getArgType(arg) {
        if (arg instanceof mir_ops_1.MIRRegisterArgument) {
            return this.vtypes.get(arg.nameID);
        }
        else {
            if (arg instanceof mir_ops_1.MIRConstantNone) {
                return this.typegen.noneType;
            }
            else if (arg instanceof mir_ops_1.MIRConstantTrue || arg instanceof mir_ops_1.MIRConstantFalse) {
                return this.typegen.boolType;
            }
            else if (arg instanceof mir_ops_1.MIRConstantInt) {
                return this.typegen.intType;
            }
            else {
                return this.typegen.stringType;
            }
        }
    }
    generateConstantExp(cval, into) {
        if (cval instanceof mir_ops_1.MIRConstantNone) {
            return this.typegen.coerce("BSQ_VALUE_NONE", this.typegen.noneType, into);
        }
        else if (cval instanceof mir_ops_1.MIRConstantTrue) {
            return this.typegen.coerce("true", this.typegen.boolType, into);
        }
        else if (cval instanceof mir_ops_1.MIRConstantFalse) {
            return this.typegen.coerce("false", this.typegen.boolType, into);
        }
        else if (cval instanceof mir_ops_1.MIRConstantInt) {
            let bint = "";
            if (cval.value === "0") {
                bint = "BSQ_VALUE_0";
            }
            else if (cval.value === "1") {
                bint = "BSQ_VALUE_POS_1";
            }
            else if (cval.value === "-1") {
                bint = "BSQ_VALUE_NEG_1";
            }
            else {
                if (Number.isSafeInteger(Number.parseInt(cval.value))) {
                    bint = `BSQ_ENCODE_VALUE_TAGGED_INT(${cval.value})`;
                }
                else {
                    const sname = "BIGINT__" + this.allConstStrings.size;
                    if (!this.allConstBigInts.has(cval.value)) {
                        this.allConstBigInts.set(cval.value, sname);
                    }
                    bint = `(Runtime::${this.allConstBigInts.get(cval.value)})`;
                }
            }
            return this.typegen.coerce(bint, this.typegen.intType, into);
        }
        else {
            assert(cval instanceof mir_ops_1.MIRConstantString);
            const sval = cval.value;
            const sname = "STR__" + this.allConstStrings.size;
            if (!this.allConstStrings.has(sval)) {
                this.allConstStrings.set(sval, sname);
            }
            const strval = `(&Runtime::${this.allConstStrings.get(sval)})`;
            return this.typegen.coerce(strval, this.typegen.stringType, into);
        }
    }
    argToCpp(arg, into) {
        if (arg instanceof mir_ops_1.MIRRegisterArgument) {
            return this.typegen.coerce(this.varToCppName(arg), this.getArgType(arg), into);
        }
        else {
            return this.generateConstantExp(arg, into);
        }
    }
    generateTruthyConvert(arg) {
        const argtype = this.getArgType(arg);
        if (this.assembly.subtypeOf(argtype, this.typegen.noneType)) {
            return "false";
        }
        else if (this.assembly.subtypeOf(argtype, this.typegen.boolType)) {
            return this.argToCpp(arg, this.typegen.boolType);
        }
        else {
            return `BSQ_GET_VALUE_TRUTHY(${this.varToCppName(arg)})`;
        }
    }
    generateNoneCheck(arg) {
        const argtype = this.getArgType(arg);
        if (this.assembly.subtypeOf(argtype, this.typegen.noneType)) {
            return "true";
        }
        else if (!this.assembly.subtypeOf(this.typegen.noneType, argtype)) {
            return "false";
        }
        else {
            return `BSQ_IS_VALUE_NONE(${this.varToCppName(arg)})`;
        }
    }
    generateLoadConstSafeString(op) {
        const sname = "STR__" + this.allConstStrings.size;
        if (!this.allConstStrings.has(op.ivalue)) {
            this.allConstStrings.set(op.ivalue, sname);
        }
        const strval = `Runtime::${this.allConstStrings.get(op.ivalue)}`;
        let opstrs = [];
        if (op.vfunckey !== undefined) {
            const chkexp = `${this.invokenameToCPP(op.vfunckey)}(${strval})`;
            opstrs.push(`if(!${chkexp}) { BSQ_ABORT("Failed string validation", "${filenameClean(this.currentFile)}", ${op.sinfo.line}); }`);
        }
        const scopevar = this.varNameToCppName("$scope$");
        opstrs.push(`${this.varToCppName(op.trgt)} =  BSQ_NEW_ADD_SCOPE(${scopevar}, BSQStringOf, ${strval}, MIRNominalTypeEnum::${this.typegen.mangleStringForCpp(op.tskey)});`);
        return opstrs.join(" ");
    }
    generateLoadConstTypedString(op) {
        const sname = "STR__" + this.allConstStrings.size;
        if (!this.allConstStrings.has(op.ivalue)) {
            this.allConstStrings.set(op.ivalue, sname);
        }
        const strval = `Runtime::${this.allConstStrings.get(op.ivalue)}`;
        const scopevar = this.varNameToCppName("$scope$");
        let opstrs = [];
        if (op.pfunckey !== undefined) {
            const chkexp = `${this.invokenameToCPP(op.pfunckey)}(${strval}, ${scopevar})`;
            opstrs.push(`if(!${chkexp}.success) { BSQ_ABORT("Failed string validation", "${filenameClean(this.currentFile)}", ${op.sinfo.line}); }`);
        }
        opstrs.push(`${this.varToCppName(op.trgt)} =  BSQ_NEW_ADD_SCOPE(${scopevar}, BSQStringOf, ${strval}, MIRNominalTypeEnum::${this.typegen.mangleStringForCpp(op.tskey)});`);
        return opstrs.join(" ");
    }
    generateAccessConstantValue(cp) {
        const cdecl = this.assembly.constantDecls.get(cp.ckey);
        const scopevar = this.typegen.getRefCountableStatus(this.typegen.getMIRType(cdecl.declaredType)) !== "no" ? this.varNameToCppName("$scope$") : "";
        return `${this.varToCppName(cp.trgt)} = ${this.invokenameToCPP(cdecl.value)}(${scopevar});`;
    }
    generateLoadFieldDefaultValue(ld) {
        const fdecl = this.assembly.fieldDecls.get(ld.fkey);
        const scopevar = this.typegen.getRefCountableStatus(this.typegen.getMIRType(fdecl.declaredType)) !== "no" ? this.varNameToCppName("$scope$") : "";
        return `${this.varToCppName(ld.trgt)} = ${this.invokenameToCPP(fdecl.value)}(${scopevar});`;
    }
    generateMIRInvokeInvariantCheckDirect(ivop) {
        const fields = [...this.typegen.assembly.entityDecls.get(ivop.tkey).fields].sort((a, b) => a.name.localeCompare(b.name));
        const args = fields.map((f) => `${this.argToCpp(ivop.rcvr, this.typegen.getMIRType(ivop.tkey))}->${this.typegen.mangleStringForCpp(f.fkey)}`);
        return `${this.varToCppName(ivop.trgt)} = ${this.invokenameToCPP(ivop.ikey)}(${args.join(", ")});`;
    }
    generateMIRConstructorPrimary(cp) {
        const ctype = this.assembly.entityDecls.get(cp.tkey);
        let fvals = cp.args.map((arg, i) => {
            const ftype = this.typegen.getMIRType(ctype.fields[i].declaredType);
            return this.typegen.generateConstructorArgInc(ftype, this.argToCpp(arg, ftype));
        });
        const cppctype = this.typegen.getCPPTypeFor(this.typegen.getMIRType(cp.tkey), "base");
        const scopevar = this.varNameToCppName("$scope$");
        return `${this.varToCppName(cp.trgt)} = BSQ_NEW_ADD_SCOPE(${scopevar}, ${cppctype}${fvals.length !== 0 ? (", " + fvals.join(", ")) : ""});`;
    }
    generateMIRConstructorPrimaryCollectionEmpty(cpce) {
        const cpetype = this.typegen.getMIRType(cpce.tkey);
        const cppctype = this.typegen.getCPPTypeFor(cpetype, "base");
        const scopevar = this.varNameToCppName("$scope$");
        const conscall = `BSQ_NEW_ADD_SCOPE(${scopevar}, ${cppctype}, MIRNominalTypeEnum::${this.typegen.mangleStringForCpp(cpce.tkey)})`;
        return `${this.varToCppName(cpce.trgt)} = ${conscall};`;
    }
    generateMIRConstructorPrimaryCollectionSingletons(cpcs) {
        const cpcstype = this.typegen.getMIRType(cpcs.tkey);
        const cppctype = this.typegen.getCPPTypeFor(cpcstype, "base");
        let conscall = "";
        const scopevar = this.varNameToCppName("$scope$");
        if (this.typegen.typecheckIsName(cpcstype, /NSCore::List<.*>/)) {
            const oftype = this.assembly.entityDecls.get(cpcs.tkey).terms.get("T");
            const cvals = cpcs.args.map((arg) => this.argToCpp(arg, oftype));
            conscall = `${cppctype}::createFromSingle<${cvals.length}>(${scopevar}, MIRNominalTypeEnum::${this.typegen.mangleStringForCpp(cpcs.tkey)}, { ${cvals.join(", ")} })`;
        }
        else if (this.typegen.typecheckIsName(cpcstype, /NSCore::Set<.*>/)) {
            const oftype = this.assembly.entityDecls.get(cpcs.tkey).terms.get("T");
            const cvals = cpcs.args.map((arg) => this.argToCpp(arg, oftype));
            conscall = `${cppctype}::createFromSingle<${cvals.length}>(${scopevar}, MIRNominalTypeEnum::${this.typegen.mangleStringForCpp(cpcs.tkey)}, { ${cvals.join(", ")} })`;
        }
        else {
            const ktype = this.assembly.entityDecls.get(cpcs.tkey).terms.get("K");
            const vtype = this.assembly.entityDecls.get(cpcs.tkey).terms.get("V");
            const entrytype = [...this.typegen.assembly.entityDecls].find((edecl) => edecl[1].ns === "NSCore" && edecl[1].name === "MapEntry" && edecl[1].terms.get("K").trkey === ktype.trkey && edecl[1].terms.get("V").trkey === vtype.trkey);
            const entryentity = entrytype[1];
            const oftype = this.assembly.typeMap.get(entryentity.tkey);
            const mkeys = cpcs.args.map((arg) => `${this.argToCpp(arg, oftype)}->${this.typegen.mangleStringForCpp(entryentity.fields.find((f) => f.name === "key").fkey)}`);
            const mvals = cpcs.args.map((arg) => `${this.argToCpp(arg, oftype)}->${this.typegen.mangleStringForCpp(entryentity.fields.find((f) => f.name === "value").fkey)}`);
            conscall = `${cppctype}::createFromSingle<${mkeys.length}>(${scopevar}, MIRNominalTypeEnum::${this.typegen.mangleStringForCpp(cpcs.tkey)}, { ${mkeys.join(", ")} }, { ${mvals.join(", ")} })`;
        }
        return `${this.varToCppName(cpcs.trgt)} = ${conscall};`;
    }
    generateMIRConstructorTuple(op) {
        const args = op.args.map((arg) => this.argToCpp(arg, this.typegen.anyType));
        if (args.length === 0) {
            return `${this.varToCppName(op.trgt)} = BSQTuple::_empty;`;
        }
        else {
            const scopevar = this.varNameToCppName("$scope$");
            const iflag = this.typegen.generateInitialDataKindFlag(this.typegen.getMIRType(op.resultTupleType));
            return `${this.varToCppName(op.trgt)} = BSQTuple::createFromSingle<${args.length}>(${scopevar}, ${iflag}, { ${args.join(", ")} });`;
        }
    }
    generateMIRConstructorRecord(op) {
        const args = op.args.map((arg) => `std::make_pair(MIRPropertyEnum::${arg[0]}, ${this.argToCpp(arg[1], this.typegen.anyType)})`);
        if (args.length === 0) {
            return `${this.varToCppName(op.trgt)} = BSQRecord::_empty;`;
        }
        else {
            const scopevar = this.varNameToCppName("$scope$");
            const iflag = this.typegen.generateInitialDataKindFlag(this.typegen.getMIRType(op.resultRecordType));
            return `${this.varToCppName(op.trgt)} = BSQRecord::createFromSingle<${args.length}>(${scopevar}, ${iflag}, { ${args.join(", ")} });`;
        }
    }
    generateMIRConstructorEphemeralValueList(op) {
        const etype = this.typegen.getMIRType(op.resultEphemeralListType).options[0];
        let args = [];
        for (let i = 0; i < op.args.length; ++i) {
            args.push(this.argToCpp(op.args[i], etype.entries[i]));
        }
        return `${this.varToCppName(op.trgt)} = ${this.typegen.mangleStringForCpp(etype.trkey)}{${args.join(", ")}};`;
    }
    generateMIRAccessFromIndexExpression(arg, idx, resultAccessType) {
        const tuptype = this.getArgType(arg);
        const hasidx = this.typegen.tupleHasIndex(tuptype, idx);
        if (hasidx === "no") {
            return `${this.typegen.coerce("BSQ_VALUE_NONE", this.typegen.noneType, resultAccessType)}`;
        }
        else {
            const select = `BSQ_GET_VALUE_PTR(${this.varToCppName(arg)}, BSQTuple)->atFixed(${idx})`;
            return `${this.typegen.coerce(select, this.typegen.anyType, resultAccessType)}`;
        }
    }
    generateMIRProjectFromIndecies(op, resultAccessType) {
        const intotypes = this.typegen.typecheckEphemeral(resultAccessType) ? resultAccessType.options[0].entries : [];
        let vals = [];
        for (let i = 0; i < op.indecies.length; ++i) {
            vals.push(this.generateMIRAccessFromIndexExpression(op.arg, op.indecies[i], intotypes[i] || this.typegen.anyType));
        }
        if (this.typegen.typecheckEphemeral(resultAccessType)) {
            return `${this.varToCppName(op.trgt)} = ${this.typegen.mangleStringForCpp(resultAccessType.trkey)}{${vals.join(", ")}};`;
        }
        else {
            const scopevar = this.varNameToCppName("$scope$");
            const iflag = this.typegen.generateInitialDataKindFlag(resultAccessType);
            return `${this.varToCppName(op.trgt)} = BSQTuple::createFromSingle<${vals.length}>(${scopevar}, ${iflag}, { ${vals.join(", ")} });`;
        }
    }
    generateMIRModifyWithIndecies(op, resultTupleType) {
        const updmax = Math.max(...op.updates.map((upd) => upd[0] + 1));
        let cvals = [];
        for (let i = 0; i < updmax; ++i) {
            const upd = op.updates.find((update) => update[0] === i);
            if (upd !== undefined) {
                cvals.push(this.argToCpp(upd[1], this.typegen.anyType));
            }
            else {
                cvals.push(this.generateMIRAccessFromIndexExpression(op.arg, i, this.typegen.anyType));
            }
        }
        const rmax = this.typegen.getMaxTupleLength(resultTupleType);
        for (let i = updmax; i < rmax; ++i) {
            //may put none in the constructor list but ok since we note correct length and will ignore these if extranious
            cvals.push(this.generateMIRAccessFromIndexExpression(op.arg, i, this.typegen.anyType));
        }
        const scopevar = this.varNameToCppName("$scope$");
        const iflag = this.typegen.generateInitialDataKindFlag(resultTupleType);
        return `${this.varToCppName(op.trgt)} = BSQTuple::createFromSingleDynamic(${scopevar}, ${iflag}, { ${cvals.join(", ")} });`;
    }
    generateMIRStructuredExtendTuple(op, resultTupleType) {
        //this is the exact number of indecies in arg -- see typecheck
        const btuple = this.typegen.getMaxTupleLength(this.typegen.getMIRType(op.argInferType));
        let cvals = [];
        for (let i = 0; i < btuple; ++i) {
            cvals.push(this.generateMIRAccessFromIndexExpression(op.arg, i, this.typegen.anyType));
        }
        const rmax = this.typegen.getMaxTupleLength(resultTupleType);
        for (let i = btuple; i < rmax; ++i) {
            //may put none in the constructor list but ok since we note correct length and will ignore these if extranious
            cvals.push(this.generateMIRAccessFromIndexExpression(op.update, i - btuple, this.typegen.anyType));
        }
        const scopevar = this.varNameToCppName("$scope$");
        const iflag = this.typegen.generateInitialDataKindFlag(resultTupleType);
        return `${this.varToCppName(op.trgt)} = BSQTuple::createFromSingleDynamic(${scopevar}, ${iflag}, { ${cvals.join(", ")} });`;
    }
    generateMIRAccessFromPropertyExpression(arg, property, resultAccessType) {
        const rectype = this.getArgType(arg);
        const hasproperty = this.typegen.recordHasField(rectype, property);
        if (hasproperty === "no") {
            return `${this.typegen.coerce("BSQ_VALUE_NONE", this.typegen.noneType, resultAccessType)}`;
        }
        else {
            const select = `BSQ_GET_VALUE_PTR(${this.varToCppName(arg)}, BSQRecord)->atFixed(MIRPropertyEnum::${property})`;
            return `${this.typegen.coerce(select, this.typegen.anyType, resultAccessType)}`;
        }
    }
    generateMIRProjectFromProperties(op, resultAccessType) {
        const intotypes = this.typegen.typecheckEphemeral(resultAccessType) ? resultAccessType.options[0].entries : [];
        let vals = [];
        for (let i = 0; i < op.properties.length; ++i) {
            vals.push(this.generateMIRAccessFromPropertyExpression(op.arg, op.properties[i], intotypes[i] || this.typegen.anyType));
        }
        if (this.typegen.typecheckEphemeral(resultAccessType)) {
            return `${this.varToCppName(op.trgt)} = ${this.typegen.mangleStringForCpp(resultAccessType.trkey)}{${vals.join(", ")}};`;
        }
        else {
            const rargs = [];
            for (let i = 0; i < op.properties.length; ++i) {
                rargs.push(`std::make_tuple<MIRRecordEnum, Value>(MIRRecordEnum::${op.properties[i]}, ${vals[i]})`);
            }
            const scopevar = this.varNameToCppName("$scope$");
            const iflag = this.typegen.generateInitialDataKindFlag(resultAccessType);
            return `${this.varToCppName(op.trgt)} = BSQRecord::createFromSingle<${rargs.length}>(${scopevar}, ${iflag}, { ${rargs.join(", ")} });`;
        }
    }
    generateMIRModifyWithProperties(op, resultRecordType) {
        const pmax = this.typegen.getMaxPropertySet(resultRecordType);
        let cvals = [];
        for (let i = 0; i < pmax.length; ++i) {
            const pname = pmax[i];
            const upd = op.updates.find((update) => update[0] === pname);
            if (upd !== undefined) {
                cvals.push(`std::make_pair<MIRRecordEnum, Value>(MIRRecordEnum::${pname}, ${this.argToCpp(upd[1], this.typegen.anyType)})`);
            }
        }
        const scopevar = this.varNameToCppName("$scope$");
        const iflag = this.typegen.generateInitialDataKindFlag(resultRecordType);
        return `${this.varToCppName(op.trgt)} = BSQRecord::createFromUpdate<${cvals.length}(${scopevar}, BSQ_GET_VALUE_PTR(${this.varToCppName(op.arg)}, BSQRecord), ${iflag}, { ${cvals.join(", ")} });`;
    }
    generateMIRStructuredExtendRecord(op, resultRecordType) {
        const rprops = this.typegen.getMaxPropertySet(resultRecordType);
        const mtype = this.typegen.getMIRType(op.updateInferType);
        let cvals = [];
        for (let i = 0; i < rprops.length; ++i) {
            const pname = rprops[i];
            const uhas = this.typegen.recordHasField(mtype, pname);
            if (uhas === "no") {
                //nothing to do
            }
            else if (uhas === "yes") {
                cvals.push(`std::make_pair<MIRRecordEnum, Value>(MIRRecordEnum::${pname}, ${this.generateMIRAccessFromPropertyExpression(op.update, pname, this.typegen.anyType)})`);
            }
            else {
                const check = `BSQ_GET_VALUE_PTR(${this.varToCppName(op.update)}, BSQRecord)->hasProperty(MIRPropertyEnum::${pname})`;
                cvals.push(`${check} ? ${this.generateMIRAccessFromPropertyExpression(op.update, pname, this.typegen.anyType)}) : ${this.generateMIRAccessFromPropertyExpression(op.arg, pname, this.typegen.anyType)})`);
            }
        }
        const scopevar = this.varNameToCppName("$scope$");
        const iflag = this.typegen.generateInitialDataKindFlag(resultRecordType);
        return `${this.varToCppName(op.trgt)} = BSQRecord::createFromUpdate<${cvals.length}>(${scopevar}, BSQ_GET_VALUE_PTR(${this.varToCppName(op.arg)}, BSQRecord), ${iflag}, { ${cvals.join(", ")} });`;
    }
    generateMIRAccessFromField(op, resultAccessType) {
        const inferargtype = this.typegen.getMIRType(op.argInferType);
        const fdecl = this.assembly.fieldDecls.get(op.field);
        const ftype = this.typegen.getMIRType(fdecl.declaredType);
        if (this.typegen.typecheckUEntity(inferargtype)) {
            const access = `${this.argToCpp(op.arg, inferargtype)}->${this.typegen.mangleStringForCpp(op.field)}`;
            return `${this.varToCppName(op.trgt)} = ${this.typegen.coerce(access, ftype, resultAccessType)};`;
        }
        else {
            const access = `BSQ_GET_VALUE_PTR(${this.argToCpp(op.arg, inferargtype)}, BSQVable)->get$${this.typegen.mangleStringForCpp(op.field)}()`;
            return `${this.varToCppName(op.trgt)} = ${this.typegen.coerce(access, ftype, resultAccessType)};`;
        }
    }
    generateMIRProjectFromFields(op, resultAccessType) {
        const inferargtype = this.typegen.getMIRType(op.argInferType);
        if (this.typegen.typecheckEphemeral(resultAccessType)) {
            let cvals = [];
            op.fields.map((f) => {
                const fdecl = this.assembly.fieldDecls.get(f);
                if (this.typegen.typecheckUEntity(inferargtype)) {
                    cvals.push(`${this.argToCpp(op.arg, inferargtype)}->${this.typegen.mangleStringForCpp(fdecl.fkey)}`);
                }
                else {
                    cvals.push(`BSQ_GET_VALUE_PTR(${this.argToCpp(op.arg, inferargtype)}, BSQVable)->get$${this.typegen.mangleStringForCpp(fdecl.fkey)}()`);
                }
            });
            return `${this.varToCppName(op.trgt)} = ${this.typegen.mangleStringForCpp(op.resultProjectType)}{${cvals.join(", ")}};`;
        }
        else {
            let cvals = [];
            op.fields.map((f) => {
                const fdecl = this.assembly.fieldDecls.get(f);
                const ftype = this.typegen.getMIRType(fdecl.declaredType);
                if (this.typegen.typecheckUEntity(inferargtype)) {
                    const access = `${this.argToCpp(op.arg, inferargtype)}->${this.typegen.mangleStringForCpp(fdecl.fkey)}`;
                    cvals.push(`std::make_pair<MIRRecordEnum, Value>(MIRRecordEnum::${fdecl.name}, ${this.typegen.coerce(access, ftype, this.typegen.anyType)})`);
                }
                else {
                    const access = `BSQ_GET_VALUE_PTR(${this.argToCpp(op.arg, inferargtype)}, BSQObject)->get$${this.typegen.mangleStringForCpp(fdecl.fkey)}()`;
                    cvals.push(`std::make_pair<MIRRecordEnum, Value>(MIRRecordEnum::${fdecl.name}, ${this.typegen.coerce(access, ftype, this.typegen.anyType)})`);
                }
            });
            const scopevar = this.varNameToCppName("$scope$");
            const iflag = this.typegen.generateInitialDataKindFlag(this.typegen.getMIRType(op.resultProjectType));
            return `${this.varToCppName(op.trgt)} = BSQRecord::createFromSingle<${cvals.length}>(${scopevar}, ${iflag}, { ${cvals.join(", ")} });`;
        }
    }
    generateVFieldUpdates(arg, infertype, fupds) {
        const upnames = fupds.map((fud) => `${fud[0].fkey}->${this.getArgType(fud[1])}`);
        const uname = `update_${upnames.sort().join("*")}_in_${infertype.trkey}`;
        let decl = this.vfieldUpdates.find((lookup) => lookup.uname === uname);
        if (decl === undefined) {
            this.vfieldUpdates.push({ arg: arg, infertype: infertype, fupds: fupds, uname: uname });
        }
        return `${this.typegen.mangleStringForCpp(uname)}(${this.argToCpp(arg, infertype)}, ${fupds.map((upd) => this.argToCpp(upd[1], this.getArgType(upd[1]))).join(", ")})`;
    }
    generateMIRModifyWithFields(op) {
        const inferargtype = this.typegen.getMIRType(op.argInferType);
        if (this.typegen.typecheckUEntity(inferargtype)) {
            const ekey = this.typegen.getEntityEKey(inferargtype);
            const utype = this.typegen.assembly.entityDecls.get(ekey);
            let cvals = [];
            for (let i = 0; i < utype.fields.length; ++i) {
                const fdecl = utype.fields[i];
                const ftype = this.typegen.getMIRType(fdecl.declaredType);
                const upd = op.updates.find((update) => update[0] == fdecl.fkey);
                if (upd !== undefined) {
                    cvals.push([this.argToCpp(upd[1], ftype), ftype]);
                }
                else {
                    cvals.push([`${this.argToCpp(op.arg, inferargtype)}->${this.typegen.mangleStringForCpp(fdecl.fkey)}`, ftype]);
                }
            }
            let fvals = cvals.map((val) => {
                return this.typegen.generateConstructorArgInc(val[1], val[0]);
            });
            const cppctype = this.typegen.getCPPTypeFor(inferargtype, "base");
            const scopevar = this.varNameToCppName("$scope$");
            const cexp = `${this.varToCppName(op.trgt)} = BSQ_NEW_ADD_SCOPE(${scopevar}, ${cppctype}${fvals.length !== 0 ? (", " + fvals.join(", ")) : ""});`;
            if (utype.invariants.length === 0) {
                return cexp;
            }
            else {
                const testexp = `${this.typegen.mangleStringForCpp("invariant::" + ekey)}(${this.varToCppName(op.trgt)});`;
                return cexp + " " + testexp;
            }
        }
        else {
            const access = this.generateVFieldUpdates(op.arg, inferargtype, op.updates.map((upd) => [this.assembly.fieldDecls.get(upd[0]), upd[1]]));
            return `${this.varToCppName(op.trgt)} = ${access};`;
        }
    }
    generateVFieldExtend(arg, infertype, merge, infermerge, fieldResolves) {
        const upnames = fieldResolves.map((fr) => `${fr[0]}->${fr[1].fkey}`);
        const mname = `merge_${infertype.trkey}_${upnames.join("*")}_with_${infermerge.trkey}`;
        let decl = this.vobjmerges.find((lookup) => lookup.mname === mname);
        if (decl === undefined) {
            this.vobjmerges.push({ arg: arg, infertype: infertype, merge: merge, infermergetype: infermerge, fieldResolves: fieldResolves, mname: mname });
        }
        return `${this.typegen.mangleStringForCpp(mname)}(${this.argToCpp(arg, infertype)}, ${this.argToCpp(merge, infermerge)})`;
    }
    generateMIRStructuredExtendObject(op) {
        const inferargtype = this.typegen.getMIRType(op.argInferType);
        const mergeargtype = this.typegen.getMIRType(op.updateInferType);
        if (this.typegen.typecheckUEntity(inferargtype)) {
            const ekey = this.typegen.getEntityEKey(inferargtype);
            const utype = this.typegen.assembly.entityDecls.get(ekey);
            let cvals = [];
            for (let i = 0; i < utype.fields.length; ++i) {
                const fdecl = utype.fields[i];
                const ftype = this.typegen.getMIRType(fdecl.declaredType);
                const fp = op.fieldResolves.find((tfp) => tfp[1] === fdecl.fkey);
                const faccess = [`${this.argToCpp(op.arg, inferargtype)}->${this.typegen.mangleStringForCpp(fdecl.fkey)}`, ftype];
                if (fp === undefined) {
                    cvals.push(faccess);
                }
                else {
                    const hasp = this.typegen.recordHasField(mergeargtype, fp[0]);
                    if (hasp === "no") {
                        cvals.push(faccess);
                    }
                    else if (hasp === "yes") {
                        cvals.push([this.generateMIRAccessFromPropertyExpression(op.arg, fp[0], ftype), ftype]);
                    }
                    else {
                        const check = `BSQ_GET_VALUE_PTR(${this.varToCppName(op.update)}, BSQRecord)->hasProperty(MIRPropertyEnum::${fp[0]})`;
                        const update = `(${check} ? ${this.generateMIRAccessFromPropertyExpression(op.update, fp[0], ftype)}) : ${faccess})`;
                        cvals.push([update, ftype]);
                    }
                }
            }
            let fvals = cvals.map((val) => {
                return this.typegen.generateConstructorArgInc(val[1], val[0]);
            });
            const cppctype = this.typegen.getCPPTypeFor(inferargtype, "base");
            const scopevar = this.varNameToCppName("$scope$");
            const cexp = `${this.varToCppName(op.trgt)} = BSQ_NEW_ADD_SCOPE(${scopevar}, ${cppctype}${fvals.length !== 0 ? (", " + fvals.join(", ")) : ""});`;
            if (utype.invariants.length === 0) {
                return cexp;
            }
            else {
                const testexp = `${this.typegen.mangleStringForCpp("invariant::" + ekey)}(${this.varToCppName(op.trgt)});`;
                return cexp + " " + testexp;
            }
        }
        else {
            const access = this.generateVFieldExtend(op.arg, inferargtype, op.update, mergeargtype, op.fieldResolves.map((fr) => [fr[0], this.assembly.fieldDecls.get(fr[1])]));
            return `${this.varToCppName(op.trgt)} = ${access};`;
        }
    }
    generateMIRLoadFromEpehmeralList(op) {
        //should never need to coearce op
        return `${this.varToCppName(op.trgt)} = ${this.varToCppName(op.arg)}.entry_${op.idx};`;
    }
    generateMIRInvokeFixedFunction(ivop) {
        let vals = [];
        const idecl = (this.assembly.invokeDecls.get(ivop.mkey) || this.assembly.primitiveInvokeDecls.get(ivop.mkey));
        for (let i = 0; i < ivop.args.length; ++i) {
            vals.push(this.argToCpp(ivop.args[i], this.typegen.getMIRType(idecl.params[i].type)));
        }
        const rtype = this.typegen.getMIRType(ivop.resultType);
        if (this.typegen.getRefCountableStatus(rtype) !== "no") {
            vals.push(this.varNameToCppName("$scope$"));
        }
        return `${this.varToCppName(ivop.trgt)} = ${this.invokenameToCPP(ivop.mkey)}(${vals.join(", ")});`;
    }
    generateEquals(op, lhsinfertype, lhs, rhsinfertype, rhs, isstrict) {
        let coreop = "";
        if (isstrict) {
            coreop = `EqualFunctor_${this.typegen.getCPPTypeFor(lhsinfertype, "base")}{}(${this.argToCpp(lhs, lhsinfertype)}, ${this.argToCpp(rhs, rhsinfertype)})`;
        }
        else {
            coreop = `EqualFunctor_KeyValue{}(${this.argToCpp(lhs, this.typegen.keyType)}, ${this.argToCpp(rhs, this.typegen.keyType)})`;
        }
        return op === "!=" ? `!${coreop}` : coreop;
    }
    generateCompare(op, lhsinfertype, lhs, rhsinfertype, rhs) {
        if (op === "<") {
            return `LessFunctor_IntValue{}(${this.argToCpp(lhs, lhsinfertype)}, ${this.argToCpp(rhs, rhsinfertype)})`;
        }
        else if (op === "<=") {
            return `LessFunctor_IntValue{}(${this.argToCpp(lhs, lhsinfertype)}, ${this.argToCpp(rhs, rhsinfertype)}) || EqualFunctor_IntValue{}(${this.argToCpp(lhs, lhsinfertype)}, ${this.argToCpp(rhs, rhsinfertype)})`;
        }
        else if (op === ">") {
            return `LessFunctor_IntValue{}(${this.argToCpp(rhs, rhsinfertype)}, ${this.argToCpp(lhs, lhsinfertype)})`;
        }
        else {
            return `LessFunctor_IntValue{}(${this.argToCpp(rhs, rhsinfertype)}, ${this.argToCpp(lhs, lhsinfertype)}) || EqualFunctor_IntValue{}(${this.argToCpp(rhs, rhsinfertype)}, ${this.argToCpp(lhs, lhsinfertype)})`;
        }
    }
    generateSubtypeTupleCheck(argv, argtype, oftype) {
        const subtypesig = `bool subtypeFROM_${this.typegen.mangleStringForCpp(argtype.trkey)}_TO_${this.typegen.mangleStringForCpp(oftype.trkey)}(const BSQTuple* atuple)`;
        if (!this.subtypeFMap.has(subtypesig)) {
            const order = this.subtypeOrderCtr++;
            let checks = [];
            checks.push(`(atuple->entries.size() <= ${oftype.entries.length})`);
            //do all the checks that argtype satisfies all the requirements of oftype -- maybe a bit inefficiently
            for (let i = 0; i < oftype.entries.length; ++i) {
                const chk = this.generateTypeCheck(`atuple->atFixed(${i})`, this.typegen.anyType, this.typegen.anyType, oftype.entries[i].type);
                if (oftype.entries[i].isOptional) {
                    checks.push(`(!atuple->hasIndex(${i}) || ${chk})`);
                }
                else {
                    checks.push(`atuple->hasIndex(${i})`);
                    checks.push(chk);
                }
            }
            let op = "";
            if (checks.includes("false")) {
                op = "false";
            }
            else {
                checks = checks.filter((chk) => chk !== "true");
                if (checks.length === 0) {
                    op = "true";
                }
                else if (checks.length === 1) {
                    op = checks[0];
                }
                else {
                    op = `(${checks.join(" && ")})`;
                }
            }
            const decl = subtypesig
                + "\n{\n"
                + `    return ${op};\n`
                + `}\n`;
            this.subtypeFMap.set(subtypesig, { order: order, decl: decl });
        }
        return `subtypeFROM_${this.typegen.mangleStringForCpp(argtype.trkey)}_TO_${this.typegen.mangleStringForCpp(oftype.trkey)}(${argv})`;
    }
    generateSubtypeRecordCheck(argv, argtype, oftype) {
        const subtypesig = `bool subtypeFROM_${this.typegen.mangleStringForCpp(argtype.trkey)}_TO_${this.typegen.mangleStringForCpp(oftype.trkey)}(const BSQRecord* arecord)`;
        if (!this.subtypeFMap.has(subtypesig)) {
            const order = this.subtypeOrderCtr++;
            let checks = [];
            //do all the checks that argtype satisfies all the requirements of oftype -- maybe a bit inefficiently
            for (let i = 0; i < oftype.entries.length; ++i) {
                const pname = oftype.entries[i].name;
                const chk = this.generateTypeCheck(`arecord->atFixed(MIRPropertyEnum::${pname})`, this.typegen.anyType, this.typegen.anyType, oftype.entries[i].type);
                if (oftype.entries[i].isOptional) {
                    checks.push(`(!arecord->hasProperty(MIRPropertyEnum::${pname}) || ${chk})`);
                }
                else {
                    checks.push(`arecord->hasProperty(MIRPropertyEnum::${pname})`);
                    checks.push(chk);
                }
            }
            //do checks that argtype doesn't have any other properties
            if (this.typegen.typecheckRecord(argtype)) {
                const allprops = this.typegen.getMaxPropertySet(argtype);
                for (let i = 0; i < allprops.length; ++i) {
                    const pname = allprops[i];
                    if (oftype.entries.find((entry) => entry.name === pname) === undefined) {
                        checks.push(`!arecord->hasProperty(MIRPropertyEnum::${pname})`);
                    }
                }
            }
            else {
                const pprops = oftype.entries.map((entry) => `MIRPropertyEnum::${entry.name}`);
                checks.push(`arecord->checkPropertySet(${oftype.entries.length}${oftype.entries.length !== 0 ? ", " : ""} ${pprops.join(", ")})`);
            }
            let op = "";
            if (checks.includes("false")) {
                op = "false";
            }
            else {
                checks = checks.filter((chk) => chk !== "true");
                if (checks.length === 0) {
                    op = "true";
                }
                else if (checks.length === 1) {
                    op = checks[0];
                }
                else {
                    op = `(${checks.join(" && ")})`;
                }
            }
            const decl = subtypesig
                + "\n{\n"
                + `    return ${op};\n`
                + `}\n`;
            this.subtypeFMap.set(subtypesig, { order: order, decl: decl });
        }
        return `subtypeFROM_${this.typegen.mangleStringForCpp(argtype.trkey)}_TO_${this.typegen.mangleStringForCpp(oftype.trkey)}(${argv})`;
    }
    generateSubtypeConceptCheck(argv, argtype, oftype) {
        const subtypesig = `bool subtypeFROM_${this.typegen.mangleStringForCpp(argtype.trkey)}_TO_${this.typegen.mangleStringForCpp(oftype.trkey)}(Value val)`;
        if (!this.subtypeFMap.has(subtypesig)) {
            const order = this.subtypeOrderCtr++;
            const moftype = this.typegen.getMIRType(oftype.trkey);
            let getenum = `auto nenum = getNominalTypeOf_Value(val);`;
            let tchk = "[INVALID]";
            if (this.typegen.assembly.subtypeOf(this.typegen.tupleType, moftype)) {
                tchk = "true";
            }
            else if (this.typegen.assembly.subtypeOf(moftype, this.typegen.apiType)) {
                tchk = `((BSQ_GET_VALUE_PTR(val, BSQTuple)->flag & DATA_KIND_API_FLAG) != DATA_KIND_CLEAR_FLAG)`;
            }
            else if (this.typegen.assembly.subtypeOf(moftype, this.typegen.podType)) {
                tchk = `((BSQ_GET_VALUE_PTR(val, BSQTuple)->flag & DATA_KIND_POD_FLAG) != DATA_KIND_CLEAR_FLAG)`;
            }
            else {
                tchk = "false";
            }
            let chktuple = `if (nenum == MIRNominalTypeEnum_Tuple) { return ${tchk}; }`;
            let rchk = "[INVALID]";
            if (this.typegen.assembly.subtypeOf(this.typegen.recordType, moftype)) {
                rchk = "true";
            }
            else if (this.typegen.assembly.subtypeOf(moftype, this.typegen.apiType)) {
                rchk = `((BSQ_GET_VALUE_PTR(val, BSQRecord)->flag & DATA_KIND_API_FLAG) != DATA_KIND_CLEAR_FLAG))`;
            }
            else if (this.typegen.assembly.subtypeOf(moftype, this.typegen.podType)) {
                rchk = `((BSQ_GET_VALUE_PTR(val, BSQRecord)->flag & DATA_KIND_POD_FLAG) != DATA_KIND_CLEAR_FLAG)`;
            }
            else {
                rchk = "false";
            }
            let chkrecord = `else if (nenum == MIRNominalTypeEnum_Record) { return ${rchk}; }`;
            let fchk = this.generateConceptArrayLookup(`getNominalTypeOf_Value(${argv})`, oftype);
            let chkrest = `else { return ${fchk}; }`;
            const decl = subtypesig
                + "\n{\n"
                + `    ${getenum}\n`
                + `    ${chktuple}\n`
                + `    ${chkrecord}\n`
                + `    ${chkrest}\n`
                + `}\n`;
            this.subtypeFMap.set(subtypesig, { order: order, decl: decl });
        }
        return `subtypeFROM_${this.typegen.mangleStringForCpp(argtype.trkey)}_TO_${this.typegen.mangleStringForCpp(oftype.trkey)}(${argv})`;
    }
    generateFastTupleTypeCheck(arg, argtype, oftype) {
        if (this.typegen.typecheckIsName(argtype, /^NSCore::Bool$/) || this.typegen.typecheckIsName(argtype, /^NSCore::Int$/) || this.typegen.typecheckIsName(argtype, /^NSCore::String$/)) {
            return "false";
        }
        else if (this.typegen.typecheckIsName(argtype, /^NSCore::SafeString<.*>$/) || this.typegen.typecheckIsName(argtype, /^NSCore::StringOf<.*>$/)) {
            return "false";
        }
        else if (this.typegen.typecheckIsName(argtype, /^NSCore::GUID$/) || this.typegen.typecheckIsName(argtype, /^NSCore::LogicalTime$/)
            || this.typegen.typecheckIsName(argtype, /^NSCore::DataHash$/) || this.typegen.typecheckIsName(argtype, /^NSCore::CryptoHash$/)) {
            return "false";
        }
        else if (this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.enumtype) || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.idkeytype)
            || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.guididkeytype) || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.logicaltimeidkeytype)
            || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.contenthashidkeytype)) {
            return "false";
        }
        else {
            if (this.typegen.typecheckAllKeys(argtype)) {
                return "false";
            }
            if (this.typegen.typecheckAllKeys(argtype)) {
                return "false";
            }
            else if (this.typegen.typecheckIsName(argtype, /^NSCore::Buffer<.*>$/)) {
                return "false";
            }
            else if (this.typegen.typecheckIsName(argtype, /^NSCore::ISOTime$/) || this.typegen.typecheckIsName(argtype, /^NSCore::Regex$/)) {
                return "false";
            }
            else if (this.typegen.typecheckRecord(argtype)) {
                return "false";
            }
            else if (this.typegen.typecheckUEntity(argtype)) {
                return "false";
            }
            else if (this.typegen.typecheckTuple(argtype)) {
                return this.generateSubtypeTupleCheck(arg, argtype, oftype);
            }
            else {
                const tsc = this.generateSubtypeTupleCheck(`BSQ_GET_VALUE_PTR(${arg}, BSQTuple)`, argtype, oftype);
                return `(BSQ_IS_VALUE_PTR(${arg}) && dynamic_cast<BSQTuple*>(BSQ_GET_VALUE_PTR(${arg}, BSQRef)) != nullptr && ${tsc})`;
            }
        }
    }
    generateFastRecordTypeCheck(arg, argtype, oftype) {
        if (this.typegen.typecheckIsName(argtype, /^NSCore::Bool$/) || this.typegen.typecheckIsName(argtype, /^NSCore::Int$/) || this.typegen.typecheckIsName(argtype, /^NSCore::String$/)) {
            return "false";
        }
        else if (this.typegen.typecheckIsName(argtype, /^NSCore::SafeString<.*>$/) || this.typegen.typecheckIsName(argtype, /^NSCore::StringOf<.*>$/)) {
            return "false";
        }
        else if (this.typegen.typecheckIsName(argtype, /^NSCore::GUID$/) || this.typegen.typecheckIsName(argtype, /^NSCore::LogicalTime$/)
            || this.typegen.typecheckIsName(argtype, /^NSCore::DataHash$/) || this.typegen.typecheckIsName(argtype, /^NSCore::CryptoHash$/)) {
            return "false";
        }
        else if (this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.enumtype) || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.idkeytype)
            || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.guididkeytype) || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.logicaltimeidkeytype)
            || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.contenthashidkeytype)) {
            return "false";
        }
        else {
            if (this.typegen.typecheckAllKeys(argtype)) {
                return "false";
            }
            if (this.typegen.typecheckAllKeys(argtype)) {
                return "false";
            }
            else if (this.typegen.typecheckIsName(argtype, /^NSCore::Buffer<.*>$/)) {
                return "false";
            }
            else if (this.typegen.typecheckIsName(argtype, /^NSCore::ISOTime$/) || this.typegen.typecheckIsName(argtype, /^NSCore::Regex$/)) {
                return "false";
            }
            else if (this.typegen.typecheckTuple(argtype)) {
                return "false";
            }
            else if (this.typegen.typecheckUEntity(argtype)) {
                return "false";
            }
            else if (this.typegen.typecheckRecord(argtype)) {
                return this.generateSubtypeRecordCheck(arg, argtype, oftype);
            }
            else {
                const tsc = this.generateSubtypeRecordCheck(`BSQ_GET_VALUE_PTR(${arg}, BSQRecord)`, argtype, oftype);
                return `(BSQ_IS_VALUE_PTR(${arg}) && dynamic_cast<BSQRecord*>(BSQ_GET_VALUE_PTR(${arg}, BSQRef)) != nullptr && ${tsc})`;
            }
        }
    }
    generateFastEntityTypeCheck(arg, argtype, oftype) {
        if (this.typegen.typecheckIsName(argtype, /^NSCore::Bool$/) || this.typegen.typecheckIsName(argtype, /^NSCore::Int$/) || this.typegen.typecheckIsName(argtype, /^NSCore::String$/)) {
            return oftype.ekey === argtype.trkey ? "true" : "false";
        }
        else if (this.typegen.typecheckIsName(argtype, /^NSCore::SafeString<.*>$/) || this.typegen.typecheckIsName(argtype, /^NSCore::StringOf<.*>$/)) {
            return oftype.ekey === argtype.trkey ? "true" : "false";
        }
        else if (this.typegen.typecheckIsName(argtype, /^NSCore::GUID$/) || this.typegen.typecheckIsName(argtype, /^NSCore::LogicalTime$/)
            || this.typegen.typecheckIsName(argtype, /^NSCore::DataHash$/) || this.typegen.typecheckIsName(argtype, /^NSCore::CryptoHash$/)) {
            return oftype.ekey === argtype.trkey ? "true" : "false";
        }
        else if (this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.enumtype) || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.idkeytype)
            || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.guididkeytype) || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.logicaltimeidkeytype)
            || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.contenthashidkeytype)) {
            return oftype.ekey === argtype.trkey ? "true" : "false";
        }
        else {
            if (this.typegen.typecheckAllKeys(argtype)) {
                return `(getNominalTypeOf_KeyValue(${arg}) == MIRNominalTypeEnum::${this.typegen.mangleStringForCpp(oftype.ekey)})`;
            }
            else if (this.typegen.typecheckIsName(argtype, /^NSCore::Buffer<.*>$/)) {
                return oftype.ekey === argtype.trkey ? "true" : "false";
            }
            else if (this.typegen.typecheckIsName(argtype, /^NSCore::ISOTime$/) || this.typegen.typecheckIsName(argtype, /^NSCore::Regex$/)) {
                return oftype.ekey === argtype.trkey ? "true" : "false";
            }
            else if (this.typegen.typecheckTuple(argtype) || this.typegen.typecheckRecord(argtype)) {
                return "false";
            }
            else if (this.typegen.typecheckUEntity(argtype)) {
                return oftype.ekey === argtype.trkey ? "true" : "false";
            }
            else {
                return `(getNominalTypeOf_Value(${arg}) == MIRNominalTypeEnum::${this.typegen.mangleStringForCpp(oftype.ekey)})`;
            }
        }
    }
    generateConceptArrayLookup(access, oftype) {
        const lookups = oftype.ckeys.map((ckey) => {
            const sizestr = this.typegen.getSubtypesArrayCount(ckey);
            const arraystr = `MIRConceptSubtypeArray__${this.typegen.mangleStringForCpp(ckey)}`;
            return sizestr === 0 ? "false" : `BSQObject::checkSubtype<${sizestr}>(${access}, ${arraystr})`;
        });
        if (lookups.find((op) => op === "false")) {
            return "false";
        }
        else if (lookups.length === 1) {
            return lookups[0];
        }
        else {
            return lookups.join(" && ");
        }
    }
    generateFastConceptTypeCheck(arg, argtype, oftype) {
        if (oftype.trkey === "NSCore::Any") {
            return "true";
        }
        if (oftype.trkey === "NSCore::Some") {
            return !this.typegen.assembly.subtypeOf(this.typegen.noneType, argtype) ? "true" : `BSQ_IS_VALUE_NONNONE(${arg})`;
        }
        const moftype = this.typegen.getMIRType(oftype.trkey);
        if (this.typegen.typecheckIsName(argtype, /^NSCore::Bool$/) || this.typegen.typecheckIsName(argtype, /^NSCore::Int$/) || this.typegen.typecheckIsName(argtype, /^NSCore::String$/)) {
            return this.typegen.assembly.subtypeOf(argtype, moftype) ? "true" : "false";
        }
        else if (this.typegen.typecheckIsName(argtype, /^NSCore::SafeString<.*>$/) || this.typegen.typecheckIsName(argtype, /^NSCore::StringOf<.*>$/)) {
            return this.typegen.assembly.subtypeOf(argtype, moftype) ? "true" : "false";
        }
        else if (this.typegen.typecheckIsName(argtype, /^NSCore::GUID$/) || this.typegen.typecheckIsName(argtype, /^NSCore::LogicalTime$/)
            || this.typegen.typecheckIsName(argtype, /^NSCore::DataHash$/) || this.typegen.typecheckIsName(argtype, /^NSCore::CryptoHash$/)) {
            return this.typegen.assembly.subtypeOf(argtype, moftype) ? "true" : "false";
        }
        else if (this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.enumtype) || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.idkeytype)
            || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.guididkeytype) || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.logicaltimeidkeytype)
            || this.typegen.typecheckEntityAndProvidesName(argtype, this.typegen.contenthashidkeytype)) {
            return this.typegen.assembly.subtypeOf(argtype, moftype) ? "true" : "false";
        }
        else {
            if (this.typegen.typecheckAllKeys(argtype)) {
                return this.generateConceptArrayLookup(`getNominalTypeOf_KeyValue(${arg})`, oftype);
            }
            else if (this.typegen.typecheckIsName(argtype, /^NSCore::Buffer<.*>$/)) {
                return this.typegen.assembly.subtypeOf(argtype, moftype) ? "true" : "false";
            }
            else if (this.typegen.typecheckIsName(argtype, /^NSCore::ISOTime$/) || this.typegen.typecheckIsName(argtype, /^NSCore::Regex$/)) {
                return this.typegen.assembly.subtypeOf(argtype, moftype) ? "true" : "false";
            }
            else if (this.typegen.typecheckTuple(argtype)) {
                if (this.typegen.assembly.subtypeOf(this.typegen.tupleType, moftype)) {
                    return "true";
                }
                if (this.typegen.assembly.subtypeOf(moftype, this.typegen.apiType)) {
                    return `((BSQ_GET_VALUE_PTR(${arg}, BSQTuple)->flag & DATA_KIND_API_FLAG) != DATA_KIND_CLEAR_FLAG)`;
                }
                if (this.typegen.assembly.subtypeOf(moftype, this.typegen.podType)) {
                    return `((BSQ_GET_VALUE_PTR(${arg}, BSQTuple)->flag & DATA_KIND_POD_FLAG) != DATA_KIND_CLEAR_FLAG)`;
                }
                return "false";
            }
            else if (this.typegen.typecheckRecord(argtype)) {
                if (this.typegen.assembly.subtypeOf(this.typegen.tupleType, moftype)) {
                    return "true";
                }
                if (this.typegen.assembly.subtypeOf(moftype, this.typegen.apiType)) {
                    return `((BSQ_GET_VALUE_PTR(${arg}, BSQRecord)->flag & DATA_KIND_API_FLAG) != DATA_KIND_CLEAR_FLAG)`;
                }
                if (this.typegen.assembly.subtypeOf(moftype, this.typegen.podType)) {
                    return `((BSQ_GET_VALUE_PTR(${arg}, BSQRecord)->flag & DATA_KIND_POD_FLAG) != DATA_KIND_CLEAR_FLAG)`;
                }
                return "false";
            }
            else if (this.typegen.typecheckUEntity(argtype)) {
                return this.typegen.assembly.subtypeOf(argtype, moftype) ? "true" : "false";
            }
            else {
                const simplenominalok = moftype.options.every((copt) => {
                    const cc = this.typegen.getMIRType(copt.trkey);
                    const maybetuple = this.typegen.assembly.subtypeOf(this.typegen.tupleType, cc);
                    const mayberecord = this.typegen.assembly.subtypeOf(this.typegen.recordType, cc);
                    const maybepod = this.typegen.assembly.subtypeOf(this.typegen.podType, cc);
                    const maybeapi = this.typegen.assembly.subtypeOf(this.typegen.apiType, cc);
                    return !(maybetuple || mayberecord || maybepod || maybeapi);
                });
                if (simplenominalok) {
                    return this.generateConceptArrayLookup(`getNominalTypeOf_Value(${arg})`, oftype);
                }
                else {
                    return this.generateSubtypeConceptCheck(arg, argtype, oftype);
                }
            }
        }
    }
    generateTypeCheck(arg, argtype, inferargtype, oftype) {
        if (inferargtype.trkey !== argtype.trkey) {
            arg = this.typegen.coerce(arg, argtype, inferargtype);
        }
        if (this.typegen.assembly.subtypeOf(inferargtype, oftype)) {
            return "true";
        }
        const tests = oftype.options.map((topt) => {
            const mtype = this.typegen.getMIRType(topt.trkey);
            assert(mtype !== undefined, "We should generate all the component types by default??");
            if (topt instanceof mir_assembly_1.MIREntityType) {
                return this.generateFastEntityTypeCheck(arg, inferargtype, topt);
            }
            else if (topt instanceof mir_assembly_1.MIRConceptType) {
                return this.generateFastConceptTypeCheck(arg, inferargtype, topt);
            }
            else if (topt instanceof mir_assembly_1.MIRTupleType) {
                return this.generateFastTupleTypeCheck(arg, inferargtype, topt);
            }
            else {
                assert(topt instanceof mir_assembly_1.MIRRecordType);
                return this.generateFastRecordTypeCheck(arg, inferargtype, topt);
            }
        })
            .filter((test) => test !== "false");
        if (tests.length === 0) {
            return "false";
        }
        else if (tests.includes("true")) {
            return "true";
        }
        else if (tests.length === 1) {
            return tests[0];
        }
        else {
            return `(${tests.join(" || ")})`;
        }
    }
    generateMIRPackStore(op) {
        if (Array.isArray(op.src)) {
            let ops = [];
            for (let i = 0; i < op.src.length; ++i) {
                ops.push(`${this.varToCppName(op.names[i])} = ${this.argToCpp(op.src[i], this.getArgType(op.names[i]))}`);
            }
            return ops.join(", ") + ";";
        }
        else {
            const tlist = this.getArgType(op.src).options[0].entries;
            let ops = [];
            for (let i = 0; i < tlist.length; ++i) {
                ops.push(`${this.varToCppName(op.names[i])} = ${this.varToCppName(op.src)}.entry_${i}`);
            }
            return ops.join(", ") + ";";
        }
    }
    generateStmt(op) {
        switch (op.tag) {
            case mir_ops_1.MIROpTag.MIRLoadConst: {
                const lcv = op;
                return `${this.varToCppName(lcv.trgt)} = ${this.generateConstantExp(lcv.src, this.getArgType(lcv.trgt))};`;
            }
            case mir_ops_1.MIROpTag.MIRLoadConstRegex: {
                const lcr = op;
                const scopevar = this.varNameToCppName("$scope$");
                return `${this.varToCppName(lcr.trgt)} = BSQ_NEW_ADD_SCOPE(${scopevar}, BSQRegex, ${lcr.restr});`;
            }
            case mir_ops_1.MIROpTag.MIRLoadConstSafeString: {
                return this.generateLoadConstSafeString(op);
            }
            case mir_ops_1.MIROpTag.MIRLoadConstTypedString: {
                return this.generateLoadConstTypedString(op);
            }
            case mir_ops_1.MIROpTag.MIRAccessConstantValue: {
                const acv = op;
                return this.generateAccessConstantValue(acv);
            }
            case mir_ops_1.MIROpTag.MIRLoadFieldDefaultValue: {
                const ldv = op;
                return this.generateLoadFieldDefaultValue(ldv);
            }
            case mir_ops_1.MIROpTag.MIRAccessArgVariable: {
                const lav = op;
                return `${this.varToCppName(lav.trgt)} = ${this.argToCpp(lav.name, this.getArgType(lav.trgt))};`;
            }
            case mir_ops_1.MIROpTag.MIRAccessLocalVariable: {
                const llv = op;
                return `${this.varToCppName(llv.trgt)} = ${this.argToCpp(llv.name, this.getArgType(llv.trgt))};`;
            }
            case mir_ops_1.MIROpTag.MIRInvokeInvariantCheckDirect: {
                const icd = op;
                return this.generateMIRInvokeInvariantCheckDirect(icd);
            }
            case mir_ops_1.MIROpTag.MIRInvokeInvariantCheckVirtualTarget: {
                return NOT_IMPLEMENTED("MIRInvokeInvariantCheckVirtualTarget");
            }
            case mir_ops_1.MIROpTag.MIRConstructorPrimary: {
                const cp = op;
                return this.generateMIRConstructorPrimary(cp);
            }
            case mir_ops_1.MIROpTag.MIRConstructorPrimaryCollectionEmpty: {
                const cpce = op;
                return this.generateMIRConstructorPrimaryCollectionEmpty(cpce);
            }
            case mir_ops_1.MIROpTag.MIRConstructorPrimaryCollectionSingletons: {
                const cpcs = op;
                return this.generateMIRConstructorPrimaryCollectionSingletons(cpcs);
            }
            case mir_ops_1.MIROpTag.MIRConstructorPrimaryCollectionCopies: {
                return NOT_IMPLEMENTED("MIRConstructorPrimaryCollectionCopies");
            }
            case mir_ops_1.MIROpTag.MIRConstructorPrimaryCollectionMixed: {
                return NOT_IMPLEMENTED("MIRConstructorPrimaryCollectionMixed");
            }
            case mir_ops_1.MIROpTag.MIRConstructorTuple: {
                return this.generateMIRConstructorTuple(op);
            }
            case mir_ops_1.MIROpTag.MIRConstructorRecord: {
                return this.generateMIRConstructorRecord(op);
            }
            case mir_ops_1.MIROpTag.MIRConstructorEphemeralValueList: {
                return this.generateMIRConstructorEphemeralValueList(op);
            }
            case mir_ops_1.MIROpTag.MIRAccessFromIndex: {
                const ai = op;
                return `${this.varToCppName(ai.trgt)} = ${this.generateMIRAccessFromIndexExpression(ai.arg, ai.idx, this.typegen.getMIRType(ai.resultAccessType))};`;
            }
            case mir_ops_1.MIROpTag.MIRProjectFromIndecies: {
                const pi = op;
                return this.generateMIRProjectFromIndecies(pi, this.typegen.getMIRType(pi.resultProjectType));
            }
            case mir_ops_1.MIROpTag.MIRAccessFromProperty: {
                const ap = op;
                return `${this.varToCppName(ap.trgt)} = ${this.generateMIRAccessFromPropertyExpression(ap.arg, ap.property, this.typegen.getMIRType(ap.resultAccessType))};`;
            }
            case mir_ops_1.MIROpTag.MIRProjectFromProperties: {
                const pp = op;
                return this.generateMIRProjectFromProperties(pp, this.typegen.getMIRType(pp.resultProjectType));
            }
            case mir_ops_1.MIROpTag.MIRAccessFromField: {
                const af = op;
                return this.generateMIRAccessFromField(af, this.typegen.getMIRType(af.resultAccessType));
            }
            case mir_ops_1.MIROpTag.MIRProjectFromFields: {
                const pf = op;
                return this.generateMIRProjectFromFields(pf, this.typegen.getMIRType(pf.resultProjectType));
            }
            case mir_ops_1.MIROpTag.MIRProjectFromTypeTuple: {
                return NOT_IMPLEMENTED("MIRProjectFromTypeTuple");
            }
            case mir_ops_1.MIROpTag.MIRProjectFromTypeRecord: {
                return NOT_IMPLEMENTED("MIRProjectFromTypeRecord");
            }
            case mir_ops_1.MIROpTag.MIRProjectFromTypeNominal: {
                return NOT_IMPLEMENTED("MIRProjectFromTypeNominal");
            }
            case mir_ops_1.MIROpTag.MIRModifyWithIndecies: {
                const mi = op;
                return this.generateMIRModifyWithIndecies(mi, this.typegen.getMIRType(mi.resultTupleType));
            }
            case mir_ops_1.MIROpTag.MIRModifyWithProperties: {
                const mp = op;
                return this.generateMIRModifyWithProperties(mp, this.typegen.getMIRType(mp.resultRecordType));
            }
            case mir_ops_1.MIROpTag.MIRModifyWithFields: {
                const mf = op;
                return this.generateMIRModifyWithFields(mf);
            }
            case mir_ops_1.MIROpTag.MIRStructuredExtendTuple: {
                const si = op;
                return this.generateMIRStructuredExtendTuple(si, this.typegen.getMIRType(si.resultTupleType));
            }
            case mir_ops_1.MIROpTag.MIRStructuredExtendRecord: {
                const sp = op;
                return this.generateMIRStructuredExtendRecord(sp, this.typegen.getMIRType(sp.resultRecordType));
            }
            case mir_ops_1.MIROpTag.MIRStructuredExtendObject: {
                const so = op;
                return this.generateMIRStructuredExtendObject(so);
            }
            case mir_ops_1.MIROpTag.MIRLoadFromEpehmeralList: {
                const le = op;
                return this.generateMIRLoadFromEpehmeralList(le);
            }
            case mir_ops_1.MIROpTag.MIRInvokeFixedFunction: {
                const invk = op;
                return this.generateMIRInvokeFixedFunction(invk);
            }
            case mir_ops_1.MIROpTag.MIRInvokeVirtualTarget: {
                return NOT_IMPLEMENTED("MIRInvokeVirtualTarget");
            }
            case mir_ops_1.MIROpTag.MIRPrefixOp: {
                const pfx = op;
                if (pfx.op === "!") {
                    const tval = this.generateTruthyConvert(pfx.arg);
                    return `${this.varToCppName(pfx.trgt)} = !${tval};`;
                }
                else {
                    if (pfx.op === "-") {
                        const scope = this.typegen.mangleStringForCpp("$scope$");
                        return `${this.varToCppName(pfx.trgt)} = op_intNegate(${scope}, ${this.argToCpp(pfx.arg, this.typegen.intType)});`;
                    }
                    else {
                        return `${this.varToCppName(pfx.trgt)} = ${this.argToCpp(pfx.arg, this.typegen.intType)};`;
                    }
                }
            }
            case mir_ops_1.MIROpTag.MIRBinOp: {
                const bop = op;
                const scope = this.typegen.mangleStringForCpp("$scope$");
                if (bop.op === "+") {
                    return `${this.varToCppName(bop.trgt)} = op_intAdd(${scope}, ${this.argToCpp(bop.lhs, this.typegen.intType)}, ${this.argToCpp(bop.rhs, this.typegen.intType)});`;
                }
                if (bop.op === "-") {
                    return `${this.varToCppName(bop.trgt)} = op_intSub(${scope}, ${this.argToCpp(bop.lhs, this.typegen.intType)}, ${this.argToCpp(bop.rhs, this.typegen.intType)});`;
                }
                if (bop.op === "*") {
                    return `${this.varToCppName(bop.trgt)} = op_intMult(${scope}, ${this.argToCpp(bop.lhs, this.typegen.intType)}, ${this.argToCpp(bop.rhs, this.typegen.intType)});`;
                }
                else if (bop.op === "/") {
                    return `${this.varToCppName(bop.trgt)} = op_intDiv(${scope}, ${this.argToCpp(bop.lhs, this.typegen.intType)}, ${this.argToCpp(bop.rhs, this.typegen.intType)}); if(${this.varToCppName(bop.trgt)} == nullptr) { BSQ_ABORT("Div by 0", "${filenameClean(this.currentFile)}", ${op.sinfo.line}); }`;
                }
                else {
                    return ` ${this.varToCppName(bop.trgt)} = op_intMod(${scope}, ${this.argToCpp(bop.lhs, this.typegen.intType)}, ${this.argToCpp(bop.rhs, this.typegen.intType)}); if(${this.varToCppName(bop.trgt)} == nullptr) { BSQ_ABORT("Mod by 0 or Negative Mod Values", "${filenameClean(this.currentFile)}", ${op.sinfo.line}); }`;
                }
            }
            case mir_ops_1.MIROpTag.MIRGetKey: {
                return NOT_IMPLEMENTED("MIRGetKey");
            }
            case mir_ops_1.MIROpTag.MIRBinEq: {
                const beq = op;
                const lhvtypeinfer = this.typegen.getMIRType(beq.lhsInferType);
                const rhvtypeinfer = this.typegen.getMIRType(beq.rhsInferType);
                return `${this.varToCppName(beq.trgt)} = ${this.generateEquals(beq.op, lhvtypeinfer, beq.lhs, rhvtypeinfer, beq.rhs, !beq.relaxed)};`;
            }
            case mir_ops_1.MIROpTag.MIRBinCmp: {
                const bcmp = op;
                const lhvtypeinfer = this.typegen.getMIRType(bcmp.lhsInferType);
                const rhvtypeinfer = this.typegen.getMIRType(bcmp.rhsInferType);
                return `${this.varToCppName(bcmp.trgt)} = ${this.generateCompare(bcmp.op, lhvtypeinfer, bcmp.lhs, rhvtypeinfer, bcmp.rhs)};`;
            }
            case mir_ops_1.MIROpTag.MIRIsTypeOfNone: {
                const ton = op;
                return `${this.varToCppName(ton.trgt)} = ${this.generateNoneCheck(ton.arg)};`;
            }
            case mir_ops_1.MIROpTag.MIRIsTypeOfSome: {
                const tos = op;
                return `${this.varToCppName(tos.trgt)} = !${this.generateNoneCheck(tos.arg)};`;
            }
            case mir_ops_1.MIROpTag.MIRIsTypeOf: {
                const top = op;
                const oftype = this.typegen.getMIRType(top.oftype);
                const argtype = this.getArgType(top.arg);
                const infertype = this.typegen.getMIRType(top.argInferType);
                return `${this.varToCppName(top.trgt)} = ${this.generateTypeCheck(this.argToCpp(top.arg, argtype), argtype, infertype, oftype)};`;
            }
            case mir_ops_1.MIROpTag.MIRRegAssign: {
                const regop = op;
                return `${this.varToCppName(regop.trgt)} = ${this.argToCpp(regop.src, this.getArgType(regop.trgt))};`;
            }
            case mir_ops_1.MIROpTag.MIRTruthyConvert: {
                const tcop = op;
                return `${this.varToCppName(tcop.trgt)} = ${this.generateTruthyConvert(tcop.src)};`;
            }
            case mir_ops_1.MIROpTag.MIRVarStore: {
                const vsop = op;
                return `${this.varToCppName(vsop.name)} = ${this.argToCpp(vsop.src, this.getArgType(vsop.name))};`;
            }
            case mir_ops_1.MIROpTag.MIRPackStore: {
                const vps = op;
                return this.generateMIRPackStore(vps);
            }
            case mir_ops_1.MIROpTag.MIRReturnAssign: {
                const raop = op;
                return `${this.varToCppName(raop.name)} = ${this.argToCpp(raop.src, this.getArgType(raop.name))};`;
            }
            case mir_ops_1.MIROpTag.MIRAbort: {
                const aop = op;
                return `BSQ_ABORT("${aop.info}", "${filenameClean(this.currentFile)}", ${aop.sinfo.line});`;
            }
            case mir_ops_1.MIROpTag.MIRDebug: {
                //debug is a nop in AOT release mode but we allow it for our debugging purposes
                const dbgop = op;
                if (dbgop.value === undefined) {
                    return "assert(false);";
                }
                else {
                    return `{ std::wstring_convert<std::codecvt_utf8<char32_t>, char32_t> conv; std::cout << conv.to_bytes(diagnostic_format(${this.argToCpp(dbgop.value, this.typegen.anyType)})) << "\\n"; }`;
                }
            }
            case mir_ops_1.MIROpTag.MIRJump: {
                const jop = op;
                return `goto ${this.labelToCpp(jop.trgtblock)};`;
            }
            case mir_ops_1.MIROpTag.MIRJumpCond: {
                const cjop = op;
                return `if(${this.generateTruthyConvert(cjop.arg)}) {goto ${this.labelToCpp(cjop.trueblock)};} else {goto ${cjop.falseblock};}`;
            }
            case mir_ops_1.MIROpTag.MIRJumpNone: {
                const njop = op;
                return `if(${this.generateNoneCheck(njop.arg)}) {goto ${this.labelToCpp(njop.noneblock)};} else {goto ${njop.someblock};}`;
            }
            case mir_ops_1.MIROpTag.MIRPhi: {
                return undefined; //handle this as a special case in the block processing code
            }
            case mir_ops_1.MIROpTag.MIRVarLifetimeStart:
            case mir_ops_1.MIROpTag.MIRVarLifetimeEnd: {
                return undefined;
            }
            default: {
                return NOT_IMPLEMENTED(`Missing case ${op.tag}`);
            }
        }
    }
    generateBlock(block) {
        let gblock = [];
        let blocki = 0;
        while (blocki < block.ops.length - 1 && block.ops[blocki] instanceof mir_ops_1.MIRPhi) {
            const phiop = block.ops[blocki];
            phiop.src.forEach((src, fblock) => {
                const assign = `${this.varToCppName(phiop.trgt)} = ${this.argToCpp(src, this.getArgType(phiop.trgt))};`;
                const inblock = this.generatedBlocks.get(fblock);
                //last entry is the jump so put before that but after all other statements
                const jmp = inblock[inblock.length - 1];
                inblock[inblock.length - 1] = assign;
                inblock.push(jmp);
            });
            ++blocki;
        }
        while (blocki < block.ops.length) {
            const gop = this.generateStmt(block.ops[blocki]);
            if (gop !== undefined) {
                gblock.push(gop);
            }
            ++blocki;
        }
        if (block.label === "exit") {
            const rctype = this.typegen.getRefCountableStatus(this.currentRType);
            if (rctype === "no") {
                //nothing needed
            }
            else if (rctype === "int") {
                gblock.push("$callerscope$.processReturnChecked(_return_);");
            }
            else if (rctype === "direct") {
                gblock.push("$callerscope$.callReturnDirect(_return_);");
            }
            else if (rctype === "checked") {
                gblock.push("$callerscope$.processReturnChecked(_return_);");
            }
            else {
                gblock.push("_return_.processForCallReturn($callerscope$);");
            }
            gblock.push("return _return_;");
        }
        this.generatedBlocks.set(block.label, gblock);
    }
    generateCPPVarDecls(body, params) {
        const scopevar = this.varNameToCppName("$scope$");
        const refscope = `    BSQRefScope ${scopevar};`;
        let vdecls = new Map();
        body.vtypes.forEach((tkey, name) => {
            if (params.findIndex((p) => p.name === name) === -1) {
                const declt = this.typegen.getCPPTypeFor(this.typegen.getMIRType(tkey), "storage");
                if (!vdecls.has(declt)) {
                    vdecls.set(declt, []);
                }
                vdecls.get(declt).push(this.varNameToCppName(name));
            }
        });
        let vdeclscpp = [];
        if (vdecls.has("bool")) {
            vdeclscpp.push(`bool ${vdecls.get("bool").join(", ")};`);
        }
        [...vdecls].sort((a, b) => a[0].localeCompare(b[0])).forEach((kv) => {
            if (kv[0] !== "bool") {
                vdeclscpp.push(kv[1].map((vname) => `${kv[0]} ${vname}`).join("; ") + ";");
            }
        });
        return [refscope, ...vdeclscpp].join("\n    ");
    }
    generateCPPInvoke(idecl) {
        this.currentFile = idecl.srcFile;
        this.currentRType = this.typegen.getMIRType(idecl.resultType);
        const args = idecl.params.map((arg) => `${this.typegen.getCPPTypeFor(this.typegen.getMIRType(arg.type), "parameter")} ${this.varNameToCppName(arg.name)}`);
        const restype = this.typegen.getCPPTypeFor(this.typegen.getMIRType(idecl.resultType), "return");
        if (this.typegen.getRefCountableStatus(this.typegen.getMIRType(idecl.resultType)) !== "no") {
            args.push(`BSQRefScope& $callerscope$`);
        }
        const decl = `${restype} ${this.invokenameToCPP(idecl.key)}(${args.join(", ")})`;
        if (idecl instanceof mir_assembly_1.MIRInvokeBodyDecl) {
            this.vtypes = new Map();
            idecl.body.vtypes.forEach((tkey, name) => {
                this.vtypes.set(name, this.assembly.typeMap.get(tkey));
            });
            this.generatedBlocks = new Map();
            const blocks = mir_info_1.topologicalOrder(idecl.body.body);
            for (let i = 0; i < blocks.length; ++i) {
                this.generateBlock(blocks[i]);
            }
            const blockstrs = [...this.generatedBlocks].map((blck) => {
                const lbl = `${this.labelToCpp(blck[0])}:\n`;
                const stmts = blck[1].map((stmt) => "    " + stmt).join("\n");
                if (lbl.startsWith("entry:")) {
                    return stmts;
                }
                else {
                    return lbl + stmts;
                }
            });
            const scopestrs = this.generateCPPVarDecls(idecl.body, idecl.params);
            return { fwddecl: decl + ";", fulldecl: `${decl}\n{\n${scopestrs}\n\n${blockstrs.join("\n\n")}\n}\n` };
        }
        else {
            assert(idecl instanceof mir_assembly_1.MIRInvokePrimitiveDecl);
            const params = idecl.params.map((arg) => this.varNameToCppName(arg.name));
            return { fwddecl: decl + ";", fulldecl: `${decl} { ${this.generateBuiltinBody(idecl, params)} }\n` };
        }
    }
    generateBuiltinBody(idecl, params) {
        const scopevar = this.varNameToCppName("$scope$");
        let bodystr = ";";
        switch (idecl.implkey) {
            case "enum_create": {
                bodystr = `auto _return_ = BSQEnum{ (uint32_t)BSQ_GET_VALUE_TAGGED_INT(${params[0]}), MIRNominalTypeEnum::${this.typegen.mangleStringForCpp(this.currentRType.trkey)} };`;
                break;
            }
            case "list_size":
            case "set_size":
            case "map_size": {
                bodystr = `auto _return_ = BSQ_ENCODE_VALUE_TAGGED_INT(${params[0]}->entries.size());`;
                break;
            }
            case "list_unsafe_get": {
                bodystr = `auto _return_ = ${params[0]}->entries[BSQ_GET_VALUE_TAGGED_INT(${params[1]})];`;
                break;
            }
            case "list_unsafe_add": {
                bodystr = `auto _return_ = ${params[0]}->unsafeAdd(${scopevar}, ${params[1]});`;
                break;
            }
            case "list_unsafe_set": {
                bodystr = `auto _return_ = ${params[0]}->unsafeSet(${scopevar}, BSQ_GET_VALUE_TAGGED_INT(${params[1]}), ${params[2]});`;
                break;
            }
            case "set_has_key":
            case "map_has_key": {
                bodystr = `auto _return_ = ${params[0]}->entries.find(${params[1]}) != ${params[0]}->entries.cend();`;
                break;
            }
            case "map_at_key": {
                bodystr = `auto _return_ = (${params[0]}->entries.find(${params[1]}))->second.first;`;
                break;
            }
            case "set_at_val": {
                bodystr = `auto _return_ = (${params[0]}->entries.find(${params[1]}))->second;`;
                break;
            }
            case "map_at_val": {
                bodystr = `auto _return_ = (${params[0]}->entries.find(${params[1]}))->second.second;`;
                break;
            }
            case "set_get_keylist":
            case "map_get_keylist": {
                bodystr = "auto _return_ = " + `${params[0]}->keys` + ";";
                break;
            }
            case "set_clear_val":
            case "map_clear_val": {
                bodystr = "auto _return_ = " + `${params[0]}->clearKey(${params[1]}, ${params[2]}, ${scopevar});`;
                break;
            }
            case "set_unsafe_update": {
                bodystr = `auto _return_ = ${params[0]}->update(${params[1]}, ${params[2]}, ${scopevar});`;
                break;
            }
            case "map_unsafe_update": {
                bodystr = `auto _return_ = ${params[0]}->update(${params[1]}, ${params[2]}, ${params[3]}, ${scopevar});`;
                break;
            }
            case "set_unsafe_add": {
                bodystr = `auto _return_ = ${params[0]}->add(${params[1]}, ${params[2]}, ${params[3]}, ${scopevar});`;
                break;
            }
            case "map_unsafe_add": {
                bodystr = `auto _return_ = ${params[0]}->add(${params[1]}, ${params[2]}, ${params[3]}, ${params[4]}, ${scopevar});`;
                break;
            }
            default: {
                bodystr = `[Builtin not defined -- ${idecl.iname}]`;
                break;
            }
        }
        const refscope = `BSQRefScope ${scopevar};`;
        let returnmgr = "";
        if (this.typegen.getRefCountableStatus(this.currentRType) !== "no") {
            const rctype = this.typegen.getRefCountableStatus(this.currentRType);
            if (rctype === "no") {
                //nothing needed
            }
            else if (rctype === "int") {
                returnmgr = "$callerscope$.processReturnChecked(_return_);";
            }
            else if (rctype === "direct") {
                returnmgr = "$callerscope$.callReturnDirect(_return_);";
            }
            else if (rctype === "checked") {
                returnmgr = "$callerscope$.processReturnChecked(_return_);";
            }
            else {
                returnmgr = "_return_.processForCallReturn($callerscope$);";
            }
        }
        return "\n    " + refscope + "\n    " + bodystr + "\n    " + returnmgr + "\n    " + "return _return_;\n";
    }
}
exports.CPPBodyEmitter = CPPBodyEmitter;
//# sourceMappingURL=cppbody_emitter.js.map